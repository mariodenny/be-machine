const mongoose = require('mongoose');

const jumlahPeminjamanSchema = new mongoose.Schema({
    disetujui_cnc: {
        type: Number,
    },
    ditolak_cnc: {
        type: Number,
    },
    menunggu_cnc: {
        type: Number,
    },
    disetujui_laser: {
        type: Number,
    },
    ditolak_laser: {
        type: Number,
    },
    menunggu_laser: {
        type: Number,
    },
    disetujui_printing: {
        type: Number,
    },
    ditolak_printing: {
        type: Number,
    },
    menunggu_printing: {
        type: Number,
    },
})

const Count = mongoose.model('Count', jumlahPeminjamanSchema);

module.exports = Count;