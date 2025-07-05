// sensorModel.js

const mongoose = require("mongoose");

const sensorSchema = new mongoose.Schema({
  button: {
    type: Boolean,
  },
  current: {
    type: Number,
  },
  waktu: {
    type: Date,
    default: Date.now,
    get: function(value) {
      if (!value) return value;
      
      // Format tanggal ke format yang diinginkan
      return value.toLocaleString('id-ID', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).replace(/\//g, '-');
    }
  },
  buzzerStatus: {
    type: Boolean,
  },
  lastBuzzerActivation: {
    type: Date,
    get: function(value) {
      if (!value) return value;
      
      return value.toLocaleString('id-ID', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).replace(/\//g, '-');
    }
  },
}, {
  toJSON: { getters: true },
  toObject: { getters: true }
});

// const mongoose = require("mongoose");

// const sensorSchema = new mongoose.Schema({
//   button: {
//     type: Boolean,
//   },
//   current: {
//     type: Number,
//   },
//   waktu: {
//     type: Date,
//     default: Date.now,
//     get: function (value) {
//       if (!value) return value;

//       // Format tanggal ke format yang diinginkan
//       return value
//         .toLocaleString("id-ID", {
//           year: "numeric",
//           month: "2-digit",
//           day: "2-digit",
//           hour: "2-digit",
//           minute: "2-digit",
//           second: "2-digit",
//           hour12: false,
//         })
//         .replace(/\//g, "-");
//     },
//   },
//   buzzerStatus: {
//     type: Boolean,
//   },
//   lastBuzzerActivation: {
//     type: Date, // Waktu terakhir buzzer dinyalakan
//   },
// });

const CncSensor = mongoose.model("CncSensor", sensorSchema);
const LaserSensor = mongoose.model("LaserSensor", sensorSchema);
const PrintingSensor = mongoose.model("PrintingSensor", sensorSchema);

module.exports = { CncSensor, LaserSensor, PrintingSensor };
