const mongoose = require("mongoose");

const thresholdSchema = new mongoose.Schema({
  normal_min: {
    type: Number,
    required: true
  },
  normal_max: {
    type: Number,
    required: true
  },
  warning_min: {
    type: Number,
    required: true
  },
  warning_max: {
    type: Number,
    required: true
  },
  unit: {
    type: String,
    required: true
  }
});

const sensorConfigSchema = new mongoose.Schema({
  sensorType: {
    type: String,
    enum: ['suhu', 'kelembaban', 'tekanan', 'getaran', 'thermocouple', 'vibration', 'current'],
    required: true
  },
  sensorId: {
    type: String,
    required: true
  },
  thresholds: thresholdSchema,
  isActive: {
    type: Boolean,
    default: true
  }
});

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

  sensorConfigs: [sensorConfigSchema],

  esp_address: {
    type: String,
    default: ""
  },
  chipId: {
    type: String,
    unique: true,
    sparse: true
  },
  imageUrl: {
    type: String,
    default: ""
  },

  createdAt: {
    type: Date,
    default: Date.now
  },

  realTimeStatus: {
    type: Map,
    of: new mongoose.Schema({
      sensorValue: {
        type: Number,
        default: 0
      },
      status: {
        type: String,
        enum: ['normal', 'warning', 'danger', 'critical'],
        default: 'normal'
      },
      lastUpdate: {
        type: Date,
        default: Date.now
      },
      sensorType: {
        type: String
      },
      unit: {
        type: String
      }
    }),
    default: () => new Map()
  },

  // Global machine status (aggregated from all sensors)
  globalStatus: {
    type: String,
    enum: ['normal', 'warning', 'danger', 'critical', 'offline'],
    default: 'normal'
  },

  relayState: {
    type: Boolean,
    default: false
  },
  buzzerState: {
    type: Boolean,
    default: false
  }
});

machineSchema.methods.updateSensorStatus = function (sensorId, sensorData) {
  const {
    sensorValue,
    sensorType,
    unit,
    status
  } = sensorData;

  this.realTimeStatus.set(sensorId, {
    sensorValue,
    status: status || 'normal',
    sensorType,
    unit,
    lastUpdate: new Date()
  });

  this.updateGlobalStatus();
};

machineSchema.methods.updateGlobalStatus = function () {
  const statusPriority = {
    'critical': 4,
    'danger': 3,
    'warning': 2,
    'normal': 1,
    'offline': 0
  };

  let highestStatus = 'normal';
  let highestPriority = 1;

  this.realTimeStatus.forEach((sensorStatus, sensorId) => {
    const priority = statusPriority[sensorStatus.status] || 1;
    if (priority > highestPriority) {
      highestPriority = priority;
      highestStatus = sensorStatus.status;
    }
  });

  this.globalStatus = highestStatus;
};



module.exports = mongoose.model("Machine", machineSchema);