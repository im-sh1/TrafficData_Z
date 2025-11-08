import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface TrafficData {
  id: string;
  name: string;
  encryptedValue: number;
  publicValue1: number;
  publicValue2: number;
  description: string;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [trafficData, setTrafficData] = useState<TrafficData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadingData, setUploadingData] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newData, setNewData] = useState({ name: "", value: "", location: "", description: "" });
  const [selectedData, setSelectedData] = useState<TrafficData | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [trafficStats, setTrafficStats] = useState({ total: 0, verified: 0, avgFlow: 0, recent: 0 });
  const [heatmapData, setHeatmapData] = useState<number[][]>([]);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const dataList: TrafficData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          dataList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: 0,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setTrafficData(dataList);
      updateStats(dataList);
      generateHeatmap(dataList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (data: TrafficData[]) => {
    const total = data.length;
    const verified = data.filter(d => d.isVerified).length;
    const avgFlow = data.length > 0 ? data.reduce((sum, d) => sum + d.publicValue1, 0) / data.length : 0;
    const recent = data.filter(d => Date.now()/1000 - d.timestamp < 60 * 60 * 24).length;
    
    setTrafficStats({ total, verified, avgFlow, recent });
  };

  const generateHeatmap = (data: TrafficData[]) => {
    const heatmap = Array(10).fill(0).map(() => Array(10).fill(0));
    data.forEach(item => {
      const x = Math.min(9, Math.max(0, Math.floor(item.publicValue1 / 10)));
      const y = Math.min(9, Math.max(0, Math.floor(item.publicValue2 / 10)));
      heatmap[y][x] += 1;
    });
    setHeatmapData(heatmap);
  };

  const uploadData = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setUploadingData(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting traffic data with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const dataValue = parseInt(newData.value) || 0;
      const businessId = `traffic-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, dataValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newData.location) || 0,
        0,
        newData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Uploading encrypted data..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Traffic data uploaded successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowUploadModal(false);
      setNewData({ name: "", value: "", location: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Upload failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setUploadingData(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const handleDecryptClick = async (data: TrafficData) => {
    const value = await decryptData(data.id);
    if (value !== null) {
      setDecryptedValue(value);
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      if (available) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Private Traffic Data Marketplace</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🚗</div>
            <h2>Connect Wallet to Access Traffic Data</h2>
            <p>Upload encrypted vehicle data or purchase anonymous traffic statistics for smart city planning</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system initialization</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start encrypted data trading</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing traffic data privacy</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading traffic data marketplace...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Private Traffic Data Marketplace</h1>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn">
            Test Contract
          </button>
          <button onClick={() => setShowUploadModal(true)} className="upload-btn">
            Upload Data
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="dashboard-panels">
        <div className="stats-panel">
          <h3>Marketplace Overview</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-value">{trafficStats.total}</span>
              <span className="stat-label">Total Datasets</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">{trafficStats.verified}</span>
              <span className="stat-label">Verified</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">{trafficStats.avgFlow.toFixed(1)}</span>
              <span className="stat-label">Avg Flow</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">{trafficStats.recent}</span>
              <span className="stat-label">Today</span>
            </div>
          </div>
        </div>

        <div className="heatmap-panel">
          <h3>Traffic Heatmap</h3>
          <div className="heatmap">
            {heatmapData.map((row, y) => (
              <div key={y} className="heatmap-row">
                {row.map((value, x) => (
                  <div 
                    key={x} 
                    className="heatmap-cell"
                    style={{ opacity: Math.min(1, value * 0.3) }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="data-section">
        <div className="section-header">
          <h2>Available Traffic Datasets</h2>
          <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        
        <div className="data-list">
          {trafficData.length === 0 ? (
            <div className="no-data">
              <p>No traffic data available</p>
              <button onClick={() => setShowUploadModal(true)} className="upload-btn">
                Upload First Dataset
              </button>
            </div>
          ) : trafficData.map((data, index) => (
            <div className="data-item" key={index}>
              <div className="data-info">
                <h4>{data.name}</h4>
                <p>{data.description}</p>
                <div className="data-meta">
                  <span>Location: {data.publicValue1}</span>
                  <span>Time: {new Date(data.timestamp * 1000).toLocaleString()}</span>
                </div>
              </div>
              <div className="data-actions">
                <button 
                  className={`decrypt-btn ${data.isVerified ? 'verified' : ''}`}
                  onClick={() => handleDecryptClick(data)}
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : data.isVerified ? "Verified" : "Decrypt"}
                </button>
                <span className="data-status">
                  {data.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {showUploadModal && (
        <div className="modal-overlay">
          <div className="upload-modal">
            <div className="modal-header">
              <h2>Upload Traffic Data</h2>
              <button onClick={() => setShowUploadModal(false)} className="close-modal">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="fhe-notice">
                <strong>FHE 🔐 Protection</strong>
                <p>Traffic data will be encrypted using Zama FHE technology</p>
              </div>
              
              <div className="form-group">
                <label>Data Name *</label>
                <input 
                  type="text" 
                  value={newData.name} 
                  onChange={(e) => setNewData({...newData, name: e.target.value})}
                  placeholder="Enter data name..."
                />
              </div>
              
              <div className="form-group">
                <label>Traffic Value (Integer) *</label>
                <input 
                  type="number" 
                  value={newData.value} 
                  onChange={(e) => setNewData({...newData, value: e.target.value})}
                  placeholder="Enter traffic value..."
                />
                <div className="data-type-label">FHE Encrypted</div>
              </div>
              
              <div className="form-group">
                <label>Location Code *</label>
                <input 
                  type="number" 
                  value={newData.location} 
                  onChange={(e) => setNewData({...newData, location: e.target.value})}
                  placeholder="Enter location code..."
                />
                <div className="data-type-label">Public Data</div>
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <input 
                  type="text" 
                  value={newData.description} 
                  onChange={(e) => setNewData({...newData, description: e.target.value})}
                  placeholder="Enter description..."
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowUploadModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={uploadData}
                disabled={uploadingData || isEncrypting || !newData.name || !newData.value || !newData.location}
                className="submit-btn"
              >
                {uploadingData || isEncrypting ? "Encrypting..." : "Upload Data"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;


