// peminjamanModel.js
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const peminjamanSchema = new mongoose.Schema({
  nama_mesin: {
    type: String,
  },
  alamat_esp: {
    type: String, // URL untuk mengakses ESP32 yang sesuai
  },
  email: {
    type: String,
    // required: true
  },
  // Menambahkan tipe pengguna
  tipe_pengguna: {
    type: String,
    enum: ["Mahasiswa", "Pekerja", "PKL", "Eksternal"],
    // required: true,
  },
  // Field untuk identifikasi berdasarkan tipe pengguna
  nomor_identitas: {
    type: String,
    // required: true,
    // Validasi berdasarkan tipe pengguna
    validate: {
      validator: function (v) {
        switch (this.tipe_pengguna) {
          case "Mahasiswa":
            return /^[0-9]{8,}$/.test(v); // Validasi NIM
          case "Pekerja":
            return /^[0-9]{18,}$/.test(v); // Validasi NIP
          case "PKL":
          case "Eksternal":
            return v.length >= 3; // Minimal 3 karakter untuk identitas eksternal
          default:
            return false;
        }
      },
      message: (props) => {
        switch (props.value.tipe_pengguna) {
          case "mahasiswa":
            return "NIM tidak valid!";
          case "pekerja":
            return "NIP tidak valid!";
          case "pkl_magang":
          case "external":
            return "Identitas tidak valid!";
          default:
            return "Nomor identitas tidak valid!";
        }
      },
    },
  },
  // Field untuk external
  asal_instansi: {
    type: String,
    required: function () {
      return this.tipe_pengguna === "external";
    },
  },
  nama_pemohon: {
    type: String,
    // required: true
  },
  tanggal_peminjaman: {
    type: Date,
    // required: true,
    get: (value) => {
      if (!value) return null;
      return value.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    },
  },
  awal_peminjaman: {
    type: Date,
    set: function (v) {
      if (v instanceof Date) return v;
      // Jika input adalah string, proses seperti sebelumnya
      if (typeof v === "string") {
        const [time, modifier] = v.split(" ");
        let [hours, minutes] = time.split(":");
        if (modifier === "PM" && hours !== "12") {
          hours = parseInt(hours, 10) + 12;
        }
        if (modifier === "AM" && hours === "12") {
          hours = "00";
        }
        const date = new Date();
        date.setHours(parseInt(hours), parseInt(minutes), 0);
        return date;
      }
      c;
    },
    get: function (v) {
      return v
        ? v.toLocaleTimeString("en-GB", {
            hour12: true,
            timeZone: "Asia/Jakarta",
          })
        : null;
    },
  },
  akhir_peminjaman: {
    type: Date,
    set: function (v) {
      if (v instanceof Date) return v;
      // Jika input adalah string, proses seperti sebelumnya
      if (typeof v === "string") {
        const [time, modifier] = v.split(" ");
        let [hours, minutes] = time.split(":");
        if (modifier === "PM" && hours !== "12") {
          hours = parseInt(hours, 10) + 12;
        }
        if (modifier === "AM" && hours === "12") {
          hours = "00";
        }
        const date = new Date();
        date.setHours(parseInt(hours), parseInt(minutes), 0);
        return date;
      }
      return v;
    },
    get: function (v) {
      return v
        ? v.toLocaleTimeString("en-GB", {
            hour12: true,
            timeZone: "Asia/Jakarta",
          })
        : null;
    },
  },
  jumlah: {
    type: Number,
    required: true,
  },
  jurusan: {
    type: String,
    // required: true
  },
  program_studi: {
    type: String,
    // required: true
  },
  kategori: {
    type: String,
    // required: true
  },
  detail_keperluan: {
    type: String,
  },
  desain_benda: {
    type: String,
    // required: true
  },
  status: {
    type: String,
  },
  alasan: {
    type: String,
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
  },
  waktu: {
    type: Date,
    default: Date.now,
  },
  extended_count: {
    type: Number,
    default: 0,
  },
  isStarted: {
    type: Boolean,
    default: false, // Menandakan apakah peminjaman sudah dimulai
  },
  isActivated: {
    type: Boolean,
    default: false, // Menandakan apakah peminjaman sudah dimulai
  },
  activatedAt: {
    type: Date,
    default: null  // akan diisi saat user mengaktifkan peminjaman
  }
});

function logWithTimestamp(message) {
  const now = new Date();
  const formattedTime = now.toLocaleString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  console.log(`[${formattedTime}] : ${message}`);
}

// Pre-save hook untuk mengatur original_akhir_peminjaman
peminjamanSchema.pre("save", function (next) {
  if (this.isNew) {
    this.original_akhir_peminjaman = this.akhir_peminjaman;
  }
  next();
});

// Definisikan fungsi di bagian atas file
function convertTimeStringToDate(timeString, tanggalPeminjaman) {
  if (!timeString || !tanggalPeminjaman) return null;

  const [time, modifier] = timeString.split(" ");
  let [hours, minutes] = time.split(":").map(Number);

  if (modifier.toLowerCase() === "pm" && hours < 12) hours += 12;
  if (modifier.toLowerCase() === "am" && hours === 12) hours = 0;

  const peminjamanDate = new Date(tanggalPeminjaman);
  peminjamanDate.setHours(hours, minutes, 0, 0);

  logWithTimestamp(
    `convertTimeStringToDate - timeString: ${timeString}, tanggalPeminjaman: ${tanggalPeminjaman}`
  );
  logWithTimestamp(`Parsed peminjamanDate: ${peminjamanDate.toISOString()}`);

  return peminjamanDate;
}

// Gunakan fungsi ini dalam pre-save hook
// Pre-save hook to reject if the peminjaman time is exceeded
peminjamanSchema.pre("save", function (next) {
  // Mendapatkan waktu sekarang dalam timezone Asia/Jakarta
  const now = new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" });

  // Parsing waktu awal peminjaman dan tanggal peminjaman
  const peminjamanDate = convertTimeStringToDate(
    this.awal_peminjaman,
    this.tanggal_peminjaman
  );

  // Ubah waktu `peminjamanDate` ke zona waktu lokal Asia/Jakarta
  const peminjamanLocal = new Date(peminjamanDate).toLocaleString("en-US", {
    timeZone: "Asia/Jakarta",
  });

  // Console log untuk melihat informasi saat ini
  logWithTimestamp(`Checking peminjaman ${this._id}:`);
  logWithTimestamp(`- Current time (now): ${now}`);
  logWithTimestamp(`- Parsed peminjamanDate (UTC): ${peminjamanDate}`);
  logWithTimestamp(`- Converted peminjamanDate (local): ${peminjamanLocal}`);
  logWithTimestamp(`- Status: ${this.status}`);

  // Perbandingan waktu
  if (
    (this.status === "Menunggu" || this.status === "Diproses") &&
    new Date(now) > new Date(peminjamanLocal)
  ) {
    logWithTimestamp(
      `Peminjaman ${this._id} ditolak otomatis karena melewati batas waktu.`
    );
    this.status = "Ditolak";
    this.alasan =
      "Peminjaman otomatis ditolak karena melebihi batas awal peminjaman.";
  } else {
    logWithTimestamp(`Peminjaman ${this._id} masih dalam batas waktu.`);
  }

  next();
});

// Modifikasi hook findOneAndUpdate di peminjamanModel.js
peminjamanSchema.pre("findOneAndUpdate", async function (next) {
  const now = new Date();
  const docToUpdate = await this.model.findOne(this.getQuery());

  if (
    docToUpdate &&
    docToUpdate.awal_peminjaman &&
    docToUpdate.tanggal_peminjaman
  ) {
    const peminjaman_start = new Date(docToUpdate.tanggal_peminjaman);
    const [hours, minutes] = docToUpdate.awal_peminjaman.split(":");

    if (hours && minutes) {
      peminjaman_start.setHours(parseInt(hours), parseInt(minutes));

      if (
        (docToUpdate.status === "Menunggu" ||
          docToUpdate.status === "Diproses") &&
        now > peminjaman_start
      ) {
        this.set({
          status: "Ditolak",
          alasan:
            "Peminjaman otomatis ditolak karena melebihi batas awal peminjaman.",
        });
        console.log(
          `Peminjaman ${docToUpdate._id} ditolak otomatis saat update karena melewati batas waktu.`
        );
      }
    }
  }
  next();
});

const Cnc = mongoose.model("Cnc", peminjamanSchema);
const Laser = mongoose.model("Laser", peminjamanSchema);
const Printing = mongoose.model("Printing", peminjamanSchema);

module.exports = { Cnc, Laser, Printing };

// ------------------------------------------------------------------------------------------------------------------------------ //

// peminjamanModel.js
// const mongoose = require('mongoose');
// const Schema = mongoose.Schema;

// const peminjamanSchema = new mongoose.Schema({
//     nama_mesin: {
//         type: String,
//     },
//     alamat_esp: {
//         type: String,  // URL untuk mengakses ESP32 yang sesuai
//     },
//     email: {
//         type: String,
//         // required: true
//     },
//     nama_pemohon: {
//         type: String,
//         // required: true
//     },
//     tanggal_peminjaman: {
//         type: Date,
//         // required: true,
//         get: (value) => {
//             if (!value) return null;
//             return value.toLocaleDateString('en-GB', {
//                 weekday: 'short',
//                 day: 'numeric',
//                 month: 'short',
//                 year: 'numeric',
//             });
//         }
//     },
//     awal_peminjaman: {
//         type: Date,
//         set: function(v) {
//             if (v instanceof Date) return v;
//             // Jika input adalah string, proses seperti sebelumnya
//             if (typeof v === 'string') {
//                 const [time, modifier] = v.split(' ');
//                 let [hours, minutes] = time.split(':');
//                 if (modifier === 'PM' && hours !== '12') {
//                     hours = parseInt(hours, 10) + 12;
//                 }
//                 if (modifier === 'AM' && hours === '12') {
//                     hours = '00';
//                 }
//                 const date = new Date();
//                 date.setHours(parseInt(hours), parseInt(minutes), 0);
//                 return date;
//             }
//             return v;
//         },
//         get: function(v) {
//             return v ? v.toLocaleTimeString('en-GB', { hour12: true, timeZone: 'Asia/Jakarta' }) : null;
//         }
//     },
//     akhir_peminjaman: {
//         type: Date,
//         set: function(v) {
//             if (v instanceof Date) return v;
//             // Jika input adalah string, proses seperti sebelumnya
//             if (typeof v === 'string') {
//                 const [time, modifier] = v.split(' ');
//                 let [hours, minutes] = time.split(':');
//                 if (modifier === 'PM' && hours !== '12') {
//                     hours = parseInt(hours, 10) + 12;
//                 }
//                 if (modifier === 'AM' && hours === '12') {
//                     hours = '00';
//                 }
//                 const date = new Date();
//                 date.setHours(parseInt(hours), parseInt(minutes), 0);
//                 return date;
//             }
//             return v;
//         },
//         get: function(v) {
//             return v ? v.toLocaleTimeString('en-GB', { hour12: true, timeZone: 'Asia/Jakarta' }) : null;
//         }
//     },
//     // awal_peminjaman: {
//     //     type: Date,
//     //     // required: true,
//     //     get: (value) => value ? value.toLocaleTimeString('en-GB', { hour12: true, timeZone: 'Asia/Jakarta' }) : null,
//     //     set: (value) => {
//     //         // Convert the input like "1:00 PM" to a Date object
//     //         const date = new Date();
//     //         const [time, modifier] = value.split(' ');
//     //         let [hours, minutes] = time.split(':');

//     //         if (modifier === 'PM' && hours !== '12') {
//     //             hours = parseInt(hours, 10) + 12;
//     //         }
//     //         if (modifier === 'AM' && hours === '12') {
//     //             hours = '00';
//     //         }

//     //         date.setHours(parseInt(hours), parseInt(minutes), 0);
//     //         date.setHours(date.getHours()); // Adjust for Jakarta timezone (UTC+7)
//     //         return date;
//     //     }
//     // },
//     // akhir_peminjaman: {
//     //     type: Date,
//     //     // required: true,
//     //     get: (value) => value ? value.toLocaleTimeString('en-GB', { hour12: true, timeZone: 'Asia/Jakarta' }) : null,
//     //     set: (value) => {
//     //         // Convert the input like "1:00 PM" to a Date object
//     //         const date = new Date();
//     //         const [time, modifier] = value.split(' ');
//     //         let [hours, minutes] = time.split(':');

//     //         if (modifier === 'PM' && hours !== '12') {
//     //             hours = parseInt(hours, 10) + 12;
//     //         }
//     //         if (modifier === 'AM' && hours === '12') {
//     //             hours = '00';
//     //         }

//     //         date.setHours(parseInt(hours), parseInt(minutes), 0);
//     //         date.setHours(date.getHours()); // Adjust for Jakarta timezone (UTC+7)
//     //         return date;
//     //     }
//     // },
//     jumlah: {
//         type: Number,
//         required: true
//     },
//     jurusan : {
//         type: String,
//         // required: true
//     },
//     program_studi: {
//         type: String,
//         // required: true
//     },
//     kategori: {
//         type: String,
//         // required: true
//     },
//     detail_keperluan: {
//         type: String,
//     },
//     desain_benda: {
//         type: String,
//         // required: true
//     },
//     status: {
//         type: String,
//     },
//     alasan: {
//         type: String,
//     },
//     user: {
//         type: Schema.Types.ObjectId,
//         ref: 'User'
//     },
//     waktu: {
//         type: Date,
//         default: Date.now,
//     },
//     extended_count: {
//         type: Number,
//         default: 0
//     },
//     isStarted: {
//         type: Boolean,
//         default: false  // Menandakan apakah peminjaman sudah dimulai
//     },
// });

// function logWithTimestamp(message) {
//     const now = new Date();
//     const formattedTime = now.toLocaleString('id-ID', {
//         day: '2-digit',
//         month: '2-digit',
//         year: 'numeric',
//         hour: '2-digit',
//         minute: '2-digit',
//         second: '2-digit',
//         hour12: false,
//     });
//     console.log(`[${formattedTime}] : ${message}`);
//   }

// // Pre-save hook untuk mengatur original_akhir_peminjaman
// peminjamanSchema.pre('save', function(next) {
//     if (this.isNew) {
//         this.original_akhir_peminjaman = this.akhir_peminjaman;
//     }
//     next();
// });

// // Definisikan fungsi di bagian atas file
// function convertTimeStringToDate(timeString, tanggalPeminjaman) {
//     if (!timeString || !tanggalPeminjaman) return null;

//     const [time, modifier] = timeString.split(' ');
//     let [hours, minutes] = time.split(':').map(Number);

//     if (modifier.toLowerCase() === 'pm' && hours < 12) hours += 12;
//     if (modifier.toLowerCase() === 'am' && hours === 12) hours = 0;

//     const peminjamanDate = new Date(tanggalPeminjaman);
//     peminjamanDate.setHours(hours, minutes, 0, 0);

//     logWithTimestamp(`convertTimeStringToDate - timeString: ${timeString}, tanggalPeminjaman: ${tanggalPeminjaman}`);
//     logWithTimestamp(`Parsed peminjamanDate: ${peminjamanDate.toISOString()}`);

//     return peminjamanDate;
// }

// // Gunakan fungsi ini dalam pre-save hook
// // Pre-save hook to reject if the peminjaman time is exceeded
// peminjamanSchema.pre('save', function(next) {
//     // Mendapatkan waktu sekarang dalam timezone Asia/Jakarta
//     const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });

//     // Parsing waktu awal peminjaman dan tanggal peminjaman
//     const peminjamanDate = convertTimeStringToDate(this.awal_peminjaman, this.tanggal_peminjaman);

//     // Ubah waktu `peminjamanDate` ke zona waktu lokal Asia/Jakarta
//     const peminjamanLocal = new Date(peminjamanDate).toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });

//     // Console log untuk melihat informasi saat ini
//     logWithTimestamp(`Checking peminjaman ${this._id}:`);
//     logWithTimestamp(`- Current time (now): ${now}`);
//     logWithTimestamp(`- Parsed peminjamanDate (UTC): ${peminjamanDate}`);
//     logWithTimestamp(`- Converted peminjamanDate (local): ${peminjamanLocal}`);
//     logWithTimestamp(`- Status: ${this.status}`);

//     // Perbandingan waktu
//     if ((this.status === 'Menunggu' || this.status === 'Diproses') && new Date(now) > new Date(peminjamanLocal)) {
//         logWithTimestamp(`Peminjaman ${this._id} ditolak otomatis karena melewati batas waktu.`);
//         this.status = 'Ditolak';
//         this.alasan = 'Peminjaman otomatis ditolak karena melebihi batas awal peminjaman.';
//     } else {
//         logWithTimestamp(`Peminjaman ${this._id} masih dalam batas waktu.`);
//     }

//     next();
// });

// // utama
// peminjamanSchema.pre('findOneAndUpdate', async function(next) {
//     const now = new Date();
//     const docToUpdate = await this.model.findOne(this.getQuery());
//     if (docToUpdate) {
//         const peminjaman_start = new Date(docToUpdate.tanggal_peminjaman);
//         const [hours, minutes] = docToUpdate.awal_peminjaman.split(':');
//         peminjaman_start.setHours(parseInt(hours), parseInt(minutes));

//         if ((docToUpdate.status === 'Menunggu' || docToUpdate.status === 'Diproses') && now > peminjaman_start) {
//             this.set({ status: 'Ditolak', alasan: 'Peminjaman otomatis ditolak karena melebihi batas awal peminjaman.' });
//             logWithTimestamp(`Peminjaman ${docToUpdate._id} ditolak otomatis saat update karena melewati batas waktu.`);
//         }
//     }
//     next();
// });

// const Cnc = mongoose.model('Cnc', peminjamanSchema);
// const Laser = mongoose.model('Laser', peminjamanSchema);
// const Printing = mongoose.model('Printing', peminjamanSchema);

// module.exports = {Cnc, Laser, Printing};

// ------------------------------------------------------------------------------------------------------------------------------ //

// Pre-save hook untuk menolak jika sudah melewati jam peminjaman dan status masih diproses
// utama
// peminjamanSchema.pre('save', async function(next) {
//     const now = new Date();
//     const peminjaman_start = new Date(this.tanggal_peminjaman);
//     const [hours, minutes] = this.awal_peminjaman.split(':');
//     peminjaman_start.setHours(parseInt(hours), parseInt(minutes));

//     if ((this.status === 'Menunggu' || this.status === 'Diproses') && now > peminjaman_start) {
//         this.status = 'Ditolak';
//         this.alasan = 'Peminjaman otomatis ditolak karena melebihi batas awal peminjaman.';
//         console.log(`Peminjaman ${this._id} ditolak otomatis karena melewati batas waktu.`);
//     }
//     next();
// });

// function parseTimeString(timeString) {
//     if (!timeString) return null;

//     // Jika sudah dalam format 24 jam
//     if (timeString.includes(':')) {
//         const [hours, minutes] = timeString.split(':').map(Number);
//         return { hours, minutes };
//     }

//     // Jika dalam format 12 jam
//     const [time, modifier] = timeString.split(' ');
//     let [hours, minutes] = time.split(':').map(Number);
//     if (modifier === 'PM' && hours < 12) hours += 12;
//     if (modifier === 'AM' && hours === 12) hours = 0;

//     return { hours, minutes };
// }

// function convertTimeStringToDate(timeString, tanggalPeminjaman) {
//     if (!timeString || !tanggalPeminjaman) return null;

//     // Split the time string and AM/PM modifier
//     const [time, modifier] = timeString.split(' ');
//     let [hours, minutes] = time.split(':').map(Number);

//     // Convert 12-hour format to 24-hour format
//     if (modifier === 'PM' && hours !== 12) {
//         hours += 12;
//     }
//     if (modifier === 'AM' && hours === 12) {
//         hours = 0;
//     }

//     // Create a new Date object for tanggal_peminjaman
//     const peminjamanDate = new Date(tanggalPeminjaman);

//     // Ensure we don't accidentally modify tanggal_peminjaman date by resetting time
//     peminjamanDate.setHours(hours, minutes, 0, 0);

//     console.log(`Peminjaman Date (local timezone): ${peminjamanDate}`);

//     return peminjamanDate;
// }

// Pre-save hook to reject if the peminjaman time is exceeded
// peminjamanSchema.pre('save', function(next) {
//     const now = new Date(); // Waktu sekarang dalam zona waktu server

//     console.log(`Original Tanggal Peminjaman: ${this.tanggal_peminjaman}`);
//     console.log(`Original Awal Peminjaman: ${this.awal_peminjaman}`);

//     // Parsing tanggal dan waktu awal peminjaman
//     const peminjamanDate = convertTimeStringToDate(this.awal_peminjaman, this.tanggal_peminjaman);

//     if (!peminjamanDate) {
//         return next(new Error('Invalid parsing for peminjaman date.'));
//     }

//     console.log(`Checking peminjaman ${this._id}:`, {
//         now: now.toISOString(),
//         peminjamanDate: peminjamanDate.toISOString(),
//         status: this.status
//     });

//     // Bandingkan dalam milidetik menggunakan getTime()
//     if ((this.status === 'Menunggu' || this.status === 'Diproses') && now.getTime() > peminjamanDate.getTime()) {
//         console.log(`Peminjaman ${this._id} ditolak otomatis karena melewati batas waktu.`);
//         this.status = 'Ditolak';
//         this.alasan = 'Peminjaman otomatis ditolak karena melebihi batas awal peminjaman.';
//     }

//     next();
// });

// peminjamanSchema.pre('save', function(next) {
//     const now = new Date();
//     const peminjamanDate = new Date(this.tanggal_peminjaman);

//     let awalTime;
//     if (typeof this.awal_peminjaman === 'string') {
//         awalTime = parseTimeString(this.awal_peminjaman);
//     } else if (this.awal_peminjaman instanceof Date) {
//         awalTime = {
//             hours: this.awal_peminjaman.getHours(),
//             minutes: this.awal_peminjaman.getMinutes()
//         };
//     } else {
//         console.error('Invalid awal_peminjaman format:', this.awal_peminjaman);
//         return next(new Error('Invalid awal_peminjaman format'));
//     }

//     if (awalTime) {
//         peminjamanDate.setHours(awalTime.hours, awalTime.minutes, 0, 0);
//     } else {
//         console.error('Could not parse awal_peminjaman:', this.awal_peminjaman);
//         return next(new Error('Could not parse awal_peminjaman'));
//     }

//     console.log(`Checking peminjaman ${this._id}:`, {
//         now: now,
//         peminjamanDate: peminjamanDate,
//         status: this.status
//     });

//     if ((this.status === 'Menunggu' || this.status === 'Diproses') && now > peminjamanDate) {
//         console.log(`Peminjaman ${this._id} ditolak otomatis karena melewati batas waktu.`);
//         this.status = 'Ditolak';
//         this.alasan = 'Peminjaman otomatis ditolak karena melebihi batas awal peminjaman.';
//     }
//     next();
// });

// peminjamanSchema.pre('save', function(next) {
//     const now = new Date();
//     const peminjamanDate = new Date(this.tanggal_peminjaman);

//     let awalTime;
//     if (typeof this.awal_peminjaman === 'string') {
//         awalTime = parseTimeString(this.awal_peminjaman);
//     } else if (this.awal_peminjaman instanceof Date) {
//         awalTime = {
//             hours: this.awal_peminjaman.getHours(),
//             minutes: this.awal_peminjaman.getMinutes()
//         };
//     } else {
//         console.error('Invalid awal_peminjaman format:', this.awal_peminjaman);
//         return next(new Error('Invalid awal_peminjaman format'));
//     }

//     if (awalTime) {
//         peminjamanDate.setHours(awalTime.hours, awalTime.minutes, 0, 0);
//     } else {
//         console.error('Could not parse awal_peminjaman:', this.awal_peminjaman);
//         return next(new Error('Could not parse awal_peminjaman'));
//     }

//     if ((this.status === 'Menunggu' || this.status === 'Diproses') && now > peminjamanDate) {
//         this.status = 'Ditolak';
//         this.alasan = 'Peminjaman otomatis ditolak karena melebihi batas awal peminjaman.';
//         console.log(`Peminjaman ${this._id} ditolak otomatis karena melewati batas waktu.`);
//     }
//     next();
// });

// peminjamanSchema.pre('findOneAndUpdate', async function(next) {
//     const now = new Date();
//     const docToUpdate = await this.model.findOne(this.getQuery());

//     if (docToUpdate) {
//         const peminjamanDate = new Date(docToUpdate.tanggal_peminjaman);

//         // Gunakan helper function untuk konversi waktu awal peminjaman
//         let awalTime;
//         if (typeof docToUpdate.awal_peminjaman === 'string') {
//             awalTime = convertTimeStringToDate(docToUpdate.awal_peminjaman);
//         } else if (docToUpdate.awal_peminjaman instanceof Date) {
//             awalTime = docToUpdate.awal_peminjaman;
//         }

//         peminjamanDate.setUTCHours(awalTime.getUTCHours(), awalTime.getUTCMinutes(), 0, 0);

//         // Perbandingan waktu secara manual
//         if ((docToUpdate.status === 'Menunggu' || docToUpdate.status === 'Diproses') && now > peminjamanDate) {
//             this.set({ status: 'Ditolak', alasan: 'Peminjaman otomatis ditolak karena melebihi batas awal peminjaman.' });
//             console.log(`Peminjaman ${docToUpdate._id} ditolak otomatis saat update karena melewati batas waktu.`);
//         }
//     }
//     next();
// });

// const Count = require('../models/countModel');

// peminjamanSchema.post('save', async function(doc) {
//     try {
//         const counts = await Count.findOne();
//         if (!counts) {
//             // Jika belum ada dokumen Count, buat baru
//             await new Count().save();
//         }
//         // Update count berdasarkan jenis mesin dan status
//         const updateField = `${doc.status.toLowerCase()}_${doc.constructor.modelName.toLowerCase()}`;
//         await Count.findOneAndUpdate({}, { $inc: { [updateField]: 1 } });
//     } catch (error) {
//         console.error('Error updating count:', error);
//     }
// });
