// // countController.js
// const Count = require('../models/countModel');
// const { Cnc, Laser, Printing } = require('../models/peminjamanModel');

// // Fungsi untuk memperbarui data count setelah penolakan otomatis
// const updateCountData = async () => {
//     try {
//         // Hitung ulang dokumen untuk setiap status dan setiap tipe mesin
//         const disetujuiCnc = await Cnc.countDocuments({ status: 'Disetujui' });
//         const ditolakCnc = await Cnc.countDocuments({ status: 'Ditolak' });
//         const menungguCnc = await Cnc.countDocuments({ status: 'Menunggu' });

//         const disetujuiLaser = await Laser.countDocuments({ status: 'Disetujui' });
//         const ditolakLaser = await Laser.countDocuments({ status: 'Ditolak' });
//         const menungguLaser = await Laser.countDocuments({ status: 'Menunggu' });

//         const disetujuiPrinting = await Printing.countDocuments({ status: 'Disetujui' });
//         const ditolakPrinting = await Printing.countDocuments({ status: 'Ditolak' });
//         const menungguPrinting = await Printing.countDocuments({ status: 'Menunggu' });

//         const countData = {
//             disetujui_cnc: disetujuiCnc,
//             ditolak_cnc: ditolakCnc,
//             menunggu_cnc: menungguCnc,
//             disetujui_laser: disetujuiLaser,
//             ditolak_laser: ditolakLaser,
//             menunggu_laser: menungguLaser,
//             disetujui_printing: disetujuiPrinting,
//             ditolak_printing: ditolakPrinting,
//             menunggu_printing: menungguPrinting,
//             waktu: new Date(),
//         };

//         // Perbarui dokumen Count atau buat baru jika belum ada
//         await Count.findOneAndUpdate({}, countData, { new: true, upsert: true });

//         console.log('Count data successfully updated.');
//     } catch (error) {
//         console.error('Error updating count data:', error);
//     }
// };

// // Fungsi untuk mendapatkan data count melalui API
// const getCounts = async (req, res) => {
//     try {
//         const updatedCount = await Count.findOne(); // Mengambil data count terbaru

//         res.status(200).json({
//             success: true,
//             status: res.statusCode,
//             message: 'Counts retrieved successfully',
//             data: updatedCount,
//         });
//     } catch (error) {
//         console.error('Error getting counts:', error);
//         res.status(500).json({
//             success: false,
//             message: 'Error getting counts',
//         });
//     }
// };

// module.exports = { getCounts, updateCountData };


// const Count = require('../models/countModel');
// const {Cnc, Laser, Printing} = require('../models/peminjamanModel');
// const { updateExpiredPeminjaman } = require('../controllers/userController');

// const getCounts = async (req, res) => {
//     try {
//          // Periksa dan perbarui status sebelum menghitung
//         // Hitung dokumen untuk setiap status dan setiap tipe mesin
//         const disetujuiCnc = await Cnc.countDocuments({status: 'Disetujui'});
//         const ditolakCnc = await Cnc.countDocuments({status: 'Ditolak'});
//         const menungguCnc = await Cnc.countDocuments({status: 'Menunggu'});

//         const disetujuiLaser = await Laser.countDocuments({status: 'Disetujui'});
//         const ditolakLaser = await Laser.countDocuments({status: 'Ditolak'});
//         const menungguLaser = await Laser.countDocuments({status: 'Menunggu'});

//         const disetujuiPrinting = await Printing.countDocuments({status: 'Disetujui'});
//         const ditolakPrinting = await Printing.countDocuments({status: 'Ditolak'});
//         const menungguPrinting = await Printing.countDocuments({status: 'Menunggu'});

//         const countData = {
//             disetujui_cnc: disetujuiCnc,
//             ditolak_cnc: ditolakCnc,
//             menunggu_cnc: menungguCnc,
//             disetujui_laser: disetujuiLaser,
//             ditolak_laser: ditolakLaser,
//             menunggu_laser: menungguLaser,
//             disetujui_printing: disetujuiPrinting,
//             ditolak_printing: ditolakPrinting,
//             menunggu_printing: menungguPrinting,
//             waktu: new Date(),
//         };

//         // Find the first document and update it, or create it if it doesn't exist
//         const updatedCount = await Count.findOneAndUpdate(
//             {},
//             countData,
//             { new: true, upsert: true }
//         );

//         res.status(200).json({
//             success: true,
//             status: res.statusCode,
//             message: 'Counts retrieved and updated successfully',
//             data: updatedCount,
//         });
//     } catch (error) {
//         console.error('Error getting counts:', error);
//         res.status(500).json({
//             success: false,
//             message: 'Error getting counts',
//         });
//     }
// };

// module.exports = { getCounts };

// const Count = require('../models/countModel');
// const {Cnc, Laser, Printing} = require('../models/peminjamanModel');
// const { updateExpiredPeminjaman } = require('../controllers/userController');

// const getCounts = async (req, res) => {
//     try {
//         console.log('Memulai proses penghitungan...');
        
//         await updateExpiredPeminjaman();
//         console.log('Pembaruan status peminjaman selesai.');

//         // Hitung dokumen untuk setiap status dan setiap tipe mesin
//         const [
//             disetujuiCnc, ditolakCnc, menungguCnc,
//             disetujuiLaser, ditolakLaser, menungguLaser,
//             disetujuiPrinting, ditolakPrinting, menungguPrinting
//         ] = await Promise.all([
//             Cnc.countDocuments({status: 'Disetujui'}),
//             Cnc.countDocuments({status: 'Ditolak'}),
//             Cnc.countDocuments({status: 'Menunggu'}),
//             Laser.countDocuments({status: 'Disetujui'}),
//             Laser.countDocuments({status: 'Ditolak'}),
//             Laser.countDocuments({status: 'Menunggu'}),
//             Printing.countDocuments({status: 'Disetujui'}),
//             Printing.countDocuments({status: 'Ditolak'}),
//             Printing.countDocuments({status: 'Menunggu'})
//         ]);

//         console.log('Penghitungan selesai.');

//         const countData = {
//             disetujui_cnc: disetujuiCnc,
//             ditolak_cnc: ditolakCnc,
//             menunggu_cnc: menungguCnc,
//             disetujui_laser: disetujuiLaser,
//             ditolak_laser: ditolakLaser,
//             menunggu_laser: menungguLaser,
//             disetujui_printing: disetujuiPrinting,
//             ditolak_printing: ditolakPrinting,
//             menunggu_printing: menungguPrinting,
//             waktu: new Date(),
//         };

//         // Find the first document and update it, or create it if it doesn't exist
//         const updatedCount = await Count.findOneAndUpdate(
//             {},
//             countData,
//             { new: true, upsert: true }
//         );

//         console.log('Data count berhasil diperbarui.');

//         res.status(200).json({
//             success: true,
//             status: res.statusCode,
//             message: 'Counts retrieved and updated successfully',
//             data: updatedCount,
//         });
//     } catch (error) {
//         console.error('Error getting counts:', error);
//         res.status(500).json({
//             success: false,
//             message: 'Error getting counts',
//         });
//     }
// };

// const getCounts = async (req, res) => {
//     try {
//         console.log('Memulai proses penghitungan...');
        
//         await updateExpiredPeminjaman();
//         console.log('Pembaruan status peminjaman selesai.');

//         // Tunggu sebentar untuk memastikan perubahan telah disimpan ke database
//         await new Promise(resolve => setTimeout(resolve, 1000));

//         // Hitung dokumen untuk setiap status dan setiap tipe mesin
//         const [
//             disetujuiCnc, ditolakCnc, menungguCnc,
//             disetujuiLaser, ditolakLaser, menungguLaser,
//             disetujuiPrinting, ditolakPrinting, menungguPrinting
//         ] = await Promise.all([
//             Cnc.countDocuments({status: 'Disetujui'}),
//             Cnc.countDocuments({status: 'Ditolak'}),
//             Cnc.countDocuments({status: 'Menunggu'}),
//             Laser.countDocuments({status: 'Disetujui'}),
//             Laser.countDocuments({status: 'Ditolak'}),
//             Laser.countDocuments({status: 'Menunggu'}),
//             Printing.countDocuments({status: 'Disetujui'}),
//             Printing.countDocuments({status: 'Ditolak'}),
//             Printing.countDocuments({status: 'Menunggu'})
//         ]);

//         console.log('Penghitungan selesai.');

//         const countData = {
//             disetujui_cnc: disetujuiCnc,
//             ditolak_cnc: ditolakCnc,
//             menunggu_cnc: menungguCnc,
//             disetujui_laser: disetujuiLaser,
//             ditolak_laser: ditolakLaser,
//             menunggu_laser: menungguLaser,
//             disetujui_printing: disetujuiPrinting,
//             ditolak_printing: ditolakPrinting,
//             menunggu_printing: menungguPrinting,
//             waktu: new Date(),
//         };

//         // Find the first document and update it, or create it if it doesn't exist
//         const updatedCount = await Count.findOneAndUpdate(
//             {},
//             countData,
//             { new: true, upsert: true }
//         );

//         console.log('Data count berhasil diperbarui.');

//         res.status(200).json({
//             success: true,
//             status: res.statusCode,
//             message: 'Counts retrieved and updated successfully',
//             data: updatedCount,
//         });
//     } catch (error) {
//         console.error('Error getting counts:', error);
//         res.status(500).json({
//             success: false,
//             message: 'Error getting counts',
//             error: error.message
//         });
//     }
// };

// const getCounts = async (req, res) => {
//     try {
//         console.log('Memulai proses penghitungan...');
        
//         await updateExpiredPeminjaman();
//         console.log('Pembaruan status peminjaman selesai.');

//         // Tunggu sebentar untuk memastikan perubahan telah disimpan ke database
//         await new Promise(resolve => setTimeout(resolve, 1000));

//         // Hitung dokumen untuk setiap status dan setiap tipe mesin
//         const [
//             disetujuiCnc, ditolakCnc, menungguCnc,
//             disetujuiLaser, ditolakLaser, menungguLaser,
//             disetujuiPrinting, ditolakPrinting, menungguPrinting
//         ] = await Promise.all([
//             Cnc.countDocuments({status: 'Disetujui'}),
//             Cnc.countDocuments({status: 'Ditolak'}),
//             Cnc.countDocuments({status: 'Menunggu'}),
//             Laser.countDocuments({status: 'Disetujui'}),
//             Laser.countDocuments({status: 'Ditolak'}),
//             Laser.countDocuments({status: 'Menunggu'}),
//             Printing.countDocuments({status: 'Disetujui'}),
//             Printing.countDocuments({status: 'Ditolak'}),
//             Printing.countDocuments({status: 'Menunggu'})
//         ]);

//         console.log('Hasil penghitungan:', {
//             cnc: { disetujui: disetujuiCnc, ditolak: ditolakCnc, menunggu: menungguCnc },
//             laser: { disetujui: disetujuiLaser, ditolak: ditolakLaser, menunggu: menungguLaser },
//             printing: { disetujui: disetujuiPrinting, ditolak: ditolakPrinting, menunggu: menungguPrinting }
//         });

//         // ... sisa kode tetap sama
//     } catch (error) {
//         console.error('Error getting counts:', error);
//         res.status(500).json({
//             success: false,
//             message: 'Error getting counts',
//             error: error.message
//         });
//     }
// };

// module.exports = { getCounts };

// const Count = require('../models/countModel');
// const {Cnc, Laser, Printing} = require('../models/peminjamanModel');
// const { updateExpiredPeminjaman } = require('../controllers/userController');

// const getCounts = async (req, res) => {
//     try {
//         console.log('Memulai proses penghitungan...');
        
//         await updateExpiredPeminjaman();
//         console.log('Pembaruan status peminjaman selesai.');

//         // Hitung dokumen untuk setiap status dan setiap tipe mesin
//         const [
//             disetujuiCnc, ditolakCnc, menungguCnc,
//             disetujuiLaser, ditolakLaser, menungguLaser,
//             disetujuiPrinting, ditolakPrinting, menungguPrinting
//         ] = await Promise.all([
//             Cnc.countDocuments({status: 'Disetujui'}),
//             Cnc.countDocuments({status: 'Ditolak'}),
//             Cnc.countDocuments({status: 'Menunggu'}),
//             Laser.countDocuments({status: 'Disetujui'}),
//             Laser.countDocuments({status: 'Ditolak'}),
//             Laser.countDocuments({status: 'Menunggu'}),
//             Printing.countDocuments({status: 'Disetujui'}),
//             Printing.countDocuments({status: 'Ditolak'}),
//             Printing.countDocuments({status: 'Menunggu'})
//         ]);

//         // Update atau buat dokumen Count
//         const updatedCount = await Count.findOneAndUpdate(
//             {},
//             {
//                 disetujui_cnc: disetujuiCnc,
//                 ditolak_cnc: ditolakCnc,
//                 menunggu_cnc: menungguCnc,
//                 disetujui_laser: disetujuiLaser,
//                 ditolak_laser: ditolakLaser,
//                 menunggu_laser: menungguLaser,
//                 disetujui_printing: disetujuiPrinting,
//                 ditolak_printing: ditolakPrinting,
//                 menunggu_printing: menungguPrinting
//             },
//             { new: true, upsert: true }
//         );

//         res.status(200).json({
//             success: true,
//             message: 'Counts retrieved and updated successfully',
//             data: updatedCount
//         });
//     } catch (error) {
//         console.error('Error getting counts:', error);
//         res.status(500).json({
//             success: false,
//             message: 'Error getting counts',
//             error: error.message
//         });
//     }
// };

// module.exports = { getCounts };

const Count = require('../models/countModel');
const {Cnc, Laser, Printing} = require('../models/peminjamanModel');
const { updateExpiredPeminjaman } = require('../controllers/userController');


// Fungsi untuk mendapatkan dan memperbarui hitungan peminjaman
async function getAndUpdateCounts(req, res) {
    console.log('Memulai proses penghitungan dan pembaruan...');

    try {
        // Perbarui peminjaman yang kadaluarsa
        try {
            const updatedExpired = await updateExpiredPeminjaman();
            console.log(`Update expired peminjaman: ${updatedExpired ? 'Berhasil' : 'Tidak ada peminjaman yang kadaluarsa'}`);
        } catch (updateError) {
            console.error('Error saat update expired peminjaman:', updateError);
            throw updateError; // Re-throw error untuk ditangkap di catch block utama
        }

        // Hitung jumlah peminjaman dari berbagai status dan jenis mesin
        const [
            disetujuiCnc, ditolakCnc, menungguCnc,
            disetujuiLaser, ditolakLaser, menungguLaser,
            disetujuiPrinting, ditolakPrinting, menungguPrinting
        ] = await Promise.all([
            Cnc.countDocuments({ status: 'Disetujui' }),
            Cnc.countDocuments({ status: 'Ditolak' }),
            Cnc.countDocuments({ status: 'Menunggu' }),
            Laser.countDocuments({ status: 'Disetujui' }),
            Laser.countDocuments({ status: 'Ditolak' }),
            Laser.countDocuments({ status: 'Menunggu' }),
            Printing.countDocuments({ status: 'Disetujui' }),
            Printing.countDocuments({ status: 'Ditolak' }),
            Printing.countDocuments({ status: 'Menunggu' })
        ]);

        // Perbarui atau buat entri baru di koleksi Count
        const updatedCount = await Count.findOneAndUpdate(
            {}, // Query untuk menemukan dokumen pertama
            {
                disetujui_cnc: disetujuiCnc,
                ditolak_cnc: ditolakCnc,
                menunggu_cnc: menungguCnc,
                disetujui_laser: disetujuiLaser,
                ditolak_laser: ditolakLaser,
                menunggu_laser: menungguLaser,
                disetujui_printing: disetujuiPrinting,
                ditolak_printing: ditolakPrinting,
                menunggu_printing: menungguPrinting
            },
            { new: true, upsert: true } // Buat dokumen baru jika tidak ada yang ditemukan
        );

        // console.log('Counts diperbarui:', updatedCount);

        const responseData = {
            success: true,
            message: 'Data count berhasil diperbarui',
            data: updatedCount.toObject()  // Pastikan ini adalah plain object
        };
        
        //console.log('Sending response:', JSON.stringify(responseData));  // Log response yang dikirim
        
        return res ? res.status(200).json(responseData) : responseData;
    } catch (error) {
        console.error('Error dalam getAndUpdateCounts:', error);
        const errorResponse = {
            success: false,
            message: 'Server Error',
            error: error.message,
            data: null 
        };
        console.log('Sending error response:', JSON.stringify(errorResponse));  // Log error response
        if (res) {
            return res.status(500).json(errorResponse);
        }
        return errorResponse;
    }
}


module.exports = { getAndUpdateCounts };

// const getCounts = async (req, res) => {
//     try {
//         console.log('Memulai proses penghitungan dan pembaruan...');
        
//         // Update expired peminjaman
//         await updateExpiredPeminjaman();
//         console.log('Pembaruan status peminjaman selesai.');

//         // Hitung dokumen untuk setiap status dan setiap tipe mesin
//         const [
//             disetujuiCnc, ditolakCnc, menungguCnc,
//             disetujuiLaser, ditolakLaser, menungguLaser,
//             disetujuiPrinting, ditolakPrinting, menungguPrinting
//         ] = await Promise.all([
//             Cnc.countDocuments({status: 'Disetujui'}),
//             Cnc.countDocuments({status: 'Ditolak'}),
//             Cnc.countDocuments({status: 'Menunggu'}),
//             Laser.countDocuments({status: 'Disetujui'}),
//             Laser.countDocuments({status: 'Ditolak'}),
//             Laser.countDocuments({status: 'Menunggu'}),
//             Printing.countDocuments({status: 'Disetujui'}),
//             Printing.countDocuments({status: 'Ditolak'}),
//             Printing.countDocuments({status: 'Menunggu'})
//         ]);

//         // Update atau buat dokumen Count
//         const updatedCount = await Count.findOneAndUpdate(
//             {},
//             {
//                 disetujui_cnc: disetujuiCnc,
//                 ditolak_cnc: ditolakCnc,
//                 menunggu_cnc: menungguCnc,
//                 disetujui_laser: disetujuiLaser,
//                 ditolak_laser: ditolakLaser,
//                 menunggu_laser: menungguLaser,
//                 disetujui_printing: disetujuiPrinting,
//                 ditolak_printing: ditolakPrinting,
//                 menunggu_printing: menungguPrinting
//             },
//             { new: true, upsert: true }
//         );

//         console.log('Counts diperbarui dan diambil.');

//         res.status(200).json({
//             success: true,
//             message: 'Counts retrieved and updated successfully',
//             data: updatedCount
//         });
//     } catch (error) {
//         console.error('Error getting and updating counts:', error);
//         res.status(500).json({
//             success: false,
//             message: 'Error getting and updating counts',
//             error: error.message
//         });
//     }
// };

// module.exports = { getCounts };