const mongoose = require("mongoose");

const sensorSchema = new mongoose.Schema({
    // Basic machine info
    machineId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Machine",
        required: false,
    },
    rentalId: {
        type: String,
    },
    chipId: {
        type: String,
        required: false,
    },
    
    // Sensor specific info
    sensorId: {
        type: String,
        required: false,
    },
    sensorType: {
        type: String,
        enum: ['suhu', "kelembaban", 'tekanan', 'getaran', 'current', 'button', 'buzzer', 'delay_test'], // TAMBAH 'delay_test'
        required: true,
    },
    
    // Sensor values - flexible untuk berbagai tipe sensor
    value: {
        type: Number,
        required: true,
    },
    unit: {
        type: String,
        default: function() {
            switch(this.sensorType) {
                case 'suhu': return '°C';
                case 'tekanan': return 'Bar';
                case 'getaran': return 'mm/s';
                case 'current': return 'A';
                case 'button': return 'state';
                case 'buzzer': return 'state';
                case 'delay_test': return 'ms'; // TAMBAH UNIT UNTUK DELAY_TEST
                default: return '';
            }
        }
    },
    
    // Legacy fields untuk backward compatibility
    current: {
        type: Number,
        default: null,
    },
    button: {
        type: Boolean,
        default: null,
    },
    buzzerStatus: {
        type: Boolean,
        default: null,
    },
    
    // MQTT info
    mqttTopic: {
        type: String,
    },
    
    // Timestamps
    waktu: {
        type: Date,
        default: Date.now,
        get: function (value) {
            if (!value) return value;
            return value
                .toLocaleString("id-ID", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false,
                })
                .replace(/\//g, "-");
        },
    },
    deviceTimestamp: {
        type: Number, // millis() dari ESP32
    },
    
    // Status info
    lastBuzzerActivation: {
        type: Date,
        get: function (value) {
            if (!value) return value;
            return value
                .toLocaleString("id-ID", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false,
                })
                .replace(/\//g, "-");
        },
    },
    
    // Quality indicators
    isValid: {
        type: Boolean,
        default: true,
    },
    errorCode: {
        type: String,
        default: null,
    },
}, {
    toJSON: { getters: true },
    toObject: { getters: true },
});

// Index untuk performance
sensorSchema.index({ machineId: 1, waktu: -1 });
sensorSchema.index({ sensorId: 1, waktu: -1 });
sensorSchema.index({ sensorType: 1, waktu: -1 });
sensorSchema.index({ chipId: 1, waktu: -1 });

// Virtual untuk human readable value dengan unit
sensorSchema.virtual('displayValue').get(function() {
    return `${this.value}${this.unit}`;
});

// Method untuk validasi nilai sensor - UPDATE UNTUK DELAY_TEST
sensorSchema.methods.validateValue = function() {
    switch(this.sensorType) {
        case 'suhu':
            return this.value >= -50 && this.value <= 1000;
        case 'tekanan':
            return this.value >= 0 && this.value <= 15;
        case 'getaran':
            return this.value >= 0 && this.value <= 1;
        case 'current':
            return this.value >= 0 && this.value <= 100;
        case 'delay_test': // TAMBAH VALIDASI UNTUK DELAY_TEST
            return this.value >= 0 && this.value <= 10000; // delay dalam ms, max 10 detik
        default:
            return true;
    }
};

sensorSchema.pre('save', function(next) {
    this.isValid = this.validateValue();
    if (this.sensorType === 'current') {
        this.current = this.value;
    }
    
    next();
});

module.exports = mongoose.model("SensorV2", sensorSchema);