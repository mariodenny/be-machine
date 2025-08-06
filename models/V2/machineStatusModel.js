const mongoose = require("mongoose");

const machineStatusSchema = new mongoose.Schema({
    machineId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Machine",
        required: true,
    },
    rentalId: {
        type: String,
    },
    chipId: {
        type: String,
        required: true,
    },
    
    // Status info dari ESP32
    status: {
        type: String,
        enum: ['ON', 'OFF', 'UNKNOWN'],
        default: 'UNKNOWN',
    },
    connectionStatus: {
        type: String,
        enum: ['online', 'offline'],
        default: 'offline',
    },
    
    // Sensor info
    activeSensors: {
        type: Number,
        default: 0,
    },
    sensorConfig: [{
        sensorId: String,
        sensorType: String,
        isActive: Boolean,
        readInterval: Number,
    }],
    
    // Performance metrics
    uptime: {
        type: Number, // seconds
        default: 0,
    },
    freeHeap: {
        type: Number,
        default: 0,
    },
    wifiRSSI: {
        type: Number,
        default: 0,
    },
    
    // Timestamps
    lastSeen: {
        type: Date,
        default: Date.now,
    },
    lastHeartbeat: {
        type: Date,
        default: Date.now,
    },
    deviceTimestamp: {
        type: Number, // millis() dari ESP32
    },
    
    // Network info
    ipAddress: {
        type: String,
    },
    
}, {
    timestamps: true,
});

// Index
machineStatusSchema.index({ machineId: 1 });
machineStatusSchema.index({ chipId: 1 });
machineStatusSchema.index({ lastSeen: -1 });

// Virtual untuk cek apakah machine online (berdasarkan heartbeat)
machineStatusSchema.virtual('isOnline').get(function() {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return this.lastHeartbeat > fiveMinutesAgo && this.connectionStatus === 'online';
});

// Method untuk update heartbeat
machineStatusSchema.methods.updateHeartbeat = function() {
    this.lastHeartbeat = new Date();
    this.lastSeen = new Date();
    return this.save();
};

module.exports = mongoose.model("MachineStatus", machineStatusSchema);