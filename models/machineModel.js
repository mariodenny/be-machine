const mongoose = require("mongoose");

const machineSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  type: {
    type: String,
    required: true
  },
  model: {
    type: String,
    required: true
  },
  description: {
    type: String
  },
  status: {
    type: String,
    enum: ["available", "maintenance", "inactive"],
    default: "available"
  },
  sensor: {
    type: String,
    default: "default_sensor_value"
  },
  esp_address: {
    type: String,
    default: ""
  },
  // chipId: { type: String, unique: true, required: false },
  imageUrl: {
    type: String,
    default: ""
  },

  createdAt: {
    type: Date,
    default: Date.now
  },
  sensorThresholds: {
    caution: {
      type: Number,
      default: function () {
        // Default values based on machine type
        if (this.type.includes('oven')) return 850;
        if (this.type.includes('frais')) return 70;
        return 60;
      }
    },
    warning: {
      type: Number,
      default: function () {
        if (this.type.includes('oven')) return 920;
        if (this.type.includes('frais')) return 85;
        return 80;
      }
    },
    autoShutdown: {
      type: Boolean,
      default: false
    } // Untuk opsi matikan mesin otomatis
  },

  realTimeStatus: {
    sensorValue: {
      type: Number,
      default: 0
    },
    status: {
      type: String,
      enum: ['normal', 'caution', 'warning', 'critical'],
      default: 'normal'
    },
    lastUpdate: {
      type: Date,
      default: Date.now
    }
  }
});

module.exports = mongoose.model("Machine", machineSchema);