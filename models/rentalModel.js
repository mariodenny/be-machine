const mongoose = require("mongoose");

const rentalSchema = new mongoose.Schema({
  machineId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Machine", 
    required: true 
  },
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true 
  },
  status: { 
    type: String, 
    enum: ["Disetujui", "Ditolak", "Pending"], 
    default: "Pending" 
  },
  awal_peminjaman: Date,
  akhir_peminjaman: Date,
  isStarted: { 
    type: Boolean, 
    default: false 
  },
  isActivated: { 
    type: Boolean, 
    default: false 
  },
  startTime: { type: Date }, // Waktu aktual mulai
  endTime: { type: Date },   // Waktu aktual selesai
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  
  // Field tambahan untuk fitur yang lebih lengkap (opsional)
  tujuan_peminjaman: String,
  admin_notes: String,
  durasi_aktual_menit: { type: Number, default: 0 },
  is_overtime: { type: Boolean, default: false }
});

// Virtual untuk menghitung durasi yang direncanakan (dalam menit)
rentalSchema.virtual('durasi_rencana_menit').get(function() {
  if (this.awal_peminjaman && this.akhir_peminjaman) {
    const durasiMs = new Date(this.akhir_peminjaman) - new Date(this.awal_peminjaman);
    return Math.floor(durasiMs / (1000 * 60));
  }
  return 0;
});

// Virtual untuk menghitung selisih waktu aktual vs rencana
rentalSchema.virtual('selisih_waktu_menit').get(function() {
  if (this.durasi_aktual_menit && this.durasi_rencana_menit) {
    return this.durasi_aktual_menit - this.durasi_rencana_menit;
  }
  return 0;
});

// Method untuk cek apakah rental sedang overtime
rentalSchema.methods.isCurrentlyOvertime = function() {
  const now = new Date();
  return this.isStarted && !this.isActivated && now > new Date(this.akhir_peminjaman);
};

// Method untuk get sisa waktu dalam menit
rentalSchema.methods.getRemainingMinutes = function() {
  if (!this.isStarted || this.isActivated) return 0;
  
  const now = new Date();
  const endTime = new Date(this.akhir_peminjaman);
  const remainingMs = endTime - now;
  
  return Math.max(0, Math.floor(remainingMs / (1000 * 60)));
};

// Ensure virtual fields are serialized
rentalSchema.set('toJSON', { virtuals: true });
rentalSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model("Rental", rentalSchema);