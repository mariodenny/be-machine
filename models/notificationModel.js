const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    body: {
      type: String,
      required: true,
    },
    data: {
      type: Object,
      default: {},
    },
    type: {
      type: String,
      required: true,
      enum: [
        "peminjaman_status",    
        "rental_ending",        
        "sensor_threshold",     
        "emergency_shutdown",   
        "system_alert",         
        "maintenance",          
        "threshold_alert"       
      ],
    },
    read: {
      type: Boolean,
      default: false,
    },
    
    // ✅ TAMBAHKAN FIELD BARU
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium"
    },
    
    rentalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rental",
      default: null
    },
    
    machineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Machine", 
      default: null
    },
    
    expiresAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);
module.exports = mongoose.models.Notification || mongoose.model("Notification", notificationSchema);