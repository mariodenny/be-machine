// models/V2/notificationModel.js
const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  // User yang menerima notifikasi
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  
  // Judul notifikasi
  title: {
    type: String,
    required: true,
    trim: true
  },
  
  // Isi/body notifikasi
  body: {
    type: String,
    required: true,
    trim: true
  },
  
  // Tipe notifikasi
  type: {
    type: String,
    enum: [
      "peminjaman_status",    // Status peminjaman (disetujui/ditolak)
      "rental_ending",        // Peminjaman akan berakhir
      "sensor_threshold",     // Alert threshold sensor
      "emergency_shutdown",   // Emergency shutdown
      "system_alert",         // Alert system
      "maintenance",          // Maintenance reminder
      "threshold_alert"       // Threshold alert (suhu, tekanan, dll)
    ],
    required: true
  },
  
  // Priority level
  priority: {
    type: String,
    enum: ["low", "medium", "high", "urgent"],
    default: "medium"
  },
  
  // Status baca
  read: {
    type: Boolean,
    default: false
  },
  
  // Data tambahan (flexible untuk berbagai tipe notifikasi)
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Untuk notifikasi rental-related
  rentalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Rental"
  },
  
  // Untuk notifikasi machine-related  
  machineId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Machine"
  },
  
  // Expiry time untuk notifikasi yang punya masa aktif
  expiresAt: {
    type: Date,
    default: null
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
  
}, {
  timestamps: true // Auto manage createdAt dan updatedAt
});

// Index untuk performance
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, read: 1 });
notificationSchema.index({ type: 1, createdAt: -1 });
notificationSchema.index({ rentalId: 1 });
notificationSchema.index({ machineId: 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Auto delete jika expires

notificationSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

notificationSchema.virtual('formattedDate').get(function() {
  return this.createdAt.toLocaleString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
});

notificationSchema.methods.markAsRead = function() {
  this.read = true;
  return this.save();
};

notificationSchema.statics.markAllAsRead = function(userId) {
  return this.updateMany(
    { userId: userId, read: false },
    { $set: { read: true } }
  );
};

notificationSchema.statics.getUnreadCount = function(userId) {
  return this.countDocuments({ 
    userId: userId, 
    read: false 
  });
};

// Static method untuk cleanup expired notifications
notificationSchema.statics.cleanupExpired = function() {
  return this.deleteMany({
    expiresAt: { $lte: new Date() }
  });
};

module.exports = mongoose.model("NotificationV2", notificationSchema);