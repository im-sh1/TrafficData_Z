pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract TrafficDataMarketplace is ZamaEthereumConfig {
    struct TrafficRecord {
        euint32 encryptedSpeed;
        euint32 encryptedLocationX;
        euint32 encryptedLocationY;
        uint256 timestamp;
        address vehicleOwner;
    }

    struct AggregatedData {
        euint32 encryptedHeatmapValue;
        uint256 startTime;
        uint256 endTime;
        uint256 price;
        address owner;
        bool isSold;
    }

    mapping(uint256 => TrafficRecord) public trafficRecords;
    mapping(uint256 => AggregatedData) public aggregatedData;
    mapping(address => uint256) public withdrawals;

    uint256 public recordCount;
    uint256 public aggregatedCount;

    event TrafficRecordAdded(uint256 indexed recordId, address indexed vehicleOwner);
    event AggregatedDataCreated(uint256 indexed dataId, address indexed owner);
    event DataSold(uint256 indexed dataId, address indexed buyer);
    event Withdrawal(address indexed payee, uint256 amount);

    constructor() ZamaEthereumConfig() {
    }

    function addTrafficRecord(
        externalEuint32 encryptedSpeed,
        bytes calldata speedProof,
        externalEuint32 encryptedLocationX,
        bytes calldata locationXProof,
        externalEuint32 encryptedLocationY,
        bytes calldata locationYProof
    ) external {
        require(FHE.isInitialized(FHE.fromExternal(encryptedSpeed, speedProof)), "Invalid encrypted speed");
        require(FHE.isInitialized(FHE.fromExternal(encryptedLocationX, locationXProof)), "Invalid encrypted location X");
        require(FHE.isInitialized(FHE.fromExternal(encryptedLocationY, locationYProof)), "Invalid encrypted location Y");

        trafficRecords[recordCount] = TrafficRecord({
            encryptedSpeed: FHE.fromExternal(encryptedSpeed, speedProof),
            encryptedLocationX: FHE.fromExternal(encryptedLocationX, locationXProof),
            encryptedLocationY: FHE.fromExternal(encryptedLocationY, locationYProof),
            timestamp: block.timestamp,
            vehicleOwner: msg.sender
        });

        FHE.allowThis(trafficRecords[recordCount].encryptedSpeed);
        FHE.allowThis(trafficRecords[recordCount].encryptedLocationX);
        FHE.allowThis(trafficRecords[recordCount].encryptedLocationY);

        FHE.makePubliclyDecryptable(trafficRecords[recordCount].encryptedSpeed);
        FHE.makePubliclyDecryptable(trafficRecords[recordCount].encryptedLocationX);
        FHE.makePubliclyDecryptable(trafficRecords[recordCount].encryptedLocationY);

        emit TrafficRecordAdded(recordCount, msg.sender);
        recordCount++;
    }

    function createAggregatedData(
        externalEuint32 encryptedHeatmapValue,
        bytes calldata heatmapProof,
        uint256 startTime,
        uint256 endTime,
        uint256 price
    ) external {
        require(FHE.isInitialized(FHE.fromExternal(encryptedHeatmapValue, heatmapProof)), "Invalid encrypted heatmap value");
        require(startTime < endTime, "Invalid time range");
        require(price > 0, "Price must be greater than zero");

        aggregatedData[aggregatedCount] = AggregatedData({
            encryptedHeatmapValue: FHE.fromExternal(encryptedHeatmapValue, heatmapProof),
            startTime: startTime,
            endTime: endTime,
            price: price,
            owner: msg.sender,
            isSold: false
        });

        FHE.allowThis(aggregatedData[aggregatedCount].encryptedHeatmapValue);
        FHE.makePubliclyDecryptable(aggregatedData[aggregatedCount].encryptedHeatmapValue);

        emit AggregatedDataCreated(aggregatedCount, msg.sender);
        aggregatedCount++;
    }

    function purchaseData(uint256 dataId) external payable {
        require(dataId < aggregatedCount, "Invalid data ID");
        require(!aggregatedData[dataId].isSold, "Data already sold");
        require(msg.value >= aggregatedData[dataId].price, "Insufficient payment");

        withdrawals[aggregatedData[dataId].owner] += msg.value;
        aggregatedData[dataId].isSold = true;

        emit DataSold(dataId, msg.sender);
    }

    function withdraw() external {
        uint256 amount = withdrawals[msg.sender];
        require(amount > 0, "No funds to withdraw");

        withdrawals[msg.sender] = 0;
        payable(msg.sender).transfer(amount);

        emit Withdrawal(msg.sender, amount);
    }

    function getTrafficRecord(uint256 recordId) external view returns (
        euint32 encryptedSpeed,
        euint32 encryptedLocationX,
        euint32 encryptedLocationY,
        uint256 timestamp,
        address vehicleOwner
    ) {
        require(recordId < recordCount, "Invalid record ID");
        TrafficRecord storage record = trafficRecords[recordId];
        return (
            record.encryptedSpeed,
            record.encryptedLocationX,
            record.encryptedLocationY,
            record.timestamp,
            record.vehicleOwner
        );
    }

    function getAggregatedData(uint256 dataId) external view returns (
        euint32 encryptedHeatmapValue,
        uint256 startTime,
        uint256 endTime,
        uint256 price,
        address owner,
        bool isSold
    ) {
        require(dataId < aggregatedCount, "Invalid data ID");
        AggregatedData storage data = aggregatedData[dataId];
        return (
            data.encryptedHeatmapValue,
            data.startTime,
            data.endTime,
            data.price,
            data.owner,
            data.isSold
        );
    }

    function getTotalRecords() external view returns (uint256) {
        return recordCount;
    }

    function getTotalAggregatedData() external view returns (uint256) {
        return aggregatedCount;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


