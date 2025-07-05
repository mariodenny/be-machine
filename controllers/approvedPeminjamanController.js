
// const getApprovedPeminjaman = async (req, res) => {
    //     try {
        //         const approvedPeminjaman = await Promise.all([
            //             Cnc.find({ status: 'Disetujui' }),
            //             Laser.find({ status: 'Disetujui' }),
            //             Printing.find({ status: 'Disetujui' })
            //         ]);
            
            //         const flattenedPeminjaman = approvedPeminjaman.flat().map(p => ({
                //             id: p._id,
                //             nama_mesin: p.nama_mesin,
                //             tanggal_peminjaman: p.tanggal_peminjaman,
                //             awal_peminjaman: p.awal_peminjaman,
                //             akhir_peminjaman: p.akhir_peminjaman,
                //             nama_pemohon: p.nama_pemohon
                //         }));
                
                //         res.status(200).json({
                    //             success: true,
                    //             data: flattenedPeminjaman
                    //         });
                    //     } catch (err) {
                        //         console.error('Error in getApprovedPeminjaman:', err);
                        //         res.status(500).json({ success: false, error: err.message });
                        //     }
                        // };
                        
                        // const getApprovedPeminjaman = async (req, res) => {
                            //     try {
                                //         const approvedPeminjaman = await Promise.all([
                                    //             Cnc.find({ status: 'Disetujui' }),
//             Laser.find({ status: 'Disetujui' }),
//             Printing.find({ status: 'Disetujui' })
//         ]);

//         const flattenedPeminjaman = approvedPeminjaman.flat().map(p => {
    //             // Assuming p.tanggal_peminjaman, p.awal_peminjaman, p.akhir_peminjaman are strings
    //             const tanggalPeminjaman = new Date(p.tanggal_peminjaman);
    //             const awalPeminjaman = new Date(p.awal_peminjaman);
    //             const akhirPeminjaman = new Date(p.akhir_peminjaman);
    
    //             return {
        //                 id: p._id,
        //                 nama_mesin: p.nama_mesin,
        //                 tanggal_peminjaman: isNaN(tanggalPeminjaman.getTime()) ? p.tanggal_peminjaman : tanggalPeminjaman.toISOString(),
        //                 awal_peminjaman: isNaN(awalPeminjaman.getTime()) ? p.awal_peminjaman : awalPeminjaman.toISOString(),
        //                 akhir_peminjaman: isNaN(akhirPeminjaman.getTime()) ? p.akhir_peminjaman : akhirPeminjaman.toISOString(),
        //                 nama_pemohon: p.nama_pemohon
        //             };
        //         });
        
//         res.status(200).json({
    //             success: true,
    //             data: flattenedPeminjaman
    //         });
    //     } catch (err) {
        //         console.error('Error in getApprovedPeminjaman:', err);
        //         res.status(500).json({ success: false, error: err.message });
        //     }
        // };
        
        // const getApprovedPeminjaman = async (req, res) => {
            //     try {
                //         const approvedPeminjaman = await Promise.all([
                    //             Cnc.find({ status: 'Disetujui' }),
                    //             Laser.find({ status: 'Disetujui' }),
                    //             Printing.find({ status: 'Disetujui' })
                    //         ]);
                    
                    //         const flattenedPeminjaman = approvedPeminjaman.flat().map(p => {
                        //             // Validate and convert strings to Date objects
                        //             const isValidDate = (dateString) => {
                            //                 const date = new Date(dateString);
                            //                 return !isNaN(date.getTime()); // check if the date is valid
                            //             };
                            
                            //             const tanggalPeminjaman = isValidDate(p.tanggal_peminjaman) ? new Date(p.tanggal_peminjaman) : null;
                            //             const awalPeminjaman = isValidDate(p.awal_peminjaman) ? new Date(p.awal_peminjaman) : null;
                            //             const akhirPeminjaman = isValidDate(p.akhir_peminjaman) ? new Date(p.akhir_peminjaman) : null;
                            
                            //             // Adjust to the right timezone (Jakarta UTC+7)
                            //             const adjustTimezone = (date) => {
                                //                 if (!date) return null; // if the date is invalid, return null
                                //                 const adjustedDate = new Date(date.getTime() - (7 * 60 * 60 * 1000)); // Jakarta is UTC+7
                                //                 return adjustedDate.toISOString().split('T')[0]; // return only the date part
                                //             };
                                
                                //             return {
                                    //                 id: p._id,
                                    //                 nama_mesin: p.nama_mesin,
                                    //                 tanggal_peminjaman: adjustTimezone(tanggalPeminjaman) || p.tanggal_peminjaman,
                                    //                 awal_peminjaman: adjustTimezone(awalPeminjaman) || p.awal_peminjaman,
                                    //                 akhir_peminjaman: adjustTimezone(akhirPeminjaman) || p.akhir_peminjaman,
                                    //                 nama_pemohon: p.nama_pemohon
                                    //             };
                                    //         });
                                    
                                    //         res.status(200).json({
                                        //             success: true,
                                        //             data: flattenedPeminjaman
                                        //         });
                                        //     } catch (err) {
                                            //         console.error('Error in getApprovedPeminjaman:', err);
                                            //         res.status(500).json({ success: false, error: err.message });
                                            //     }
                                            // };

// approvedPeminjamanController.js
                                            
const { Cnc, Laser, Printing } = require('../models/peminjamanModel');

const getApprovedPeminjaman = async (req, res) => {
    try {
        const approvedPeminjaman = await Promise.all([
            Cnc.find({ status: 'Disetujui' }),
            Laser.find({ status: 'Disetujui' }),
            Printing.find({ status: 'Disetujui' })
        ]);
        
        const flattenedPeminjaman = approvedPeminjaman.flat().map(p => {
            const convertToJakartaTime = (dateString) => {
                const date = new Date(dateString);
                date.setHours(date.getHours() + 7); // Adjust to Jakarta time (UTC+7)
                return date.toISOString().split('T')[0]; // return only the date part
            };

            const formatTime = (time) => {
                if (time instanceof Date) {
                    return time.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
                } else if (typeof time === 'string') {
                    // Assuming the time is stored in "HH:mm" format
                    return time;
                } else {
                    console.error('Unexpected time format:', time);
                    return 'Invalid Time';
                }
            };

            const tanggalPeminjaman = convertToJakartaTime(p.tanggal_peminjaman);
            const awalPeminjaman = formatTime(p.awal_peminjaman);
            const akhirPeminjaman = formatTime(p.akhir_peminjaman);

            return {
                id: p._id,
                nama_mesin: p.nama_mesin,
                tanggal_peminjaman: tanggalPeminjaman,
                awal_peminjaman: awalPeminjaman,
                akhir_peminjaman: akhirPeminjaman,
                nama_pemohon: p.nama_pemohon
            };
        });

        // console.log('Sending approved peminjaman:', flattenedPeminjaman);

        res.status(200).json({
            success: true,
            data: flattenedPeminjaman
        });
    } catch (err) {
        console.error('Error in getApprovedPeminjaman:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};


const getApprovedPeminjamanByDate = async (req, res) => {
    try {
        const { date } = req.params;
        const startDate = new Date(date);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(date);
        endDate.setHours(23, 59, 59, 999);

        const approvedPeminjaman = await Promise.all([
            Cnc.find({ status: 'Disetujui', tanggal_peminjaman: { $gte: startDate, $lte: endDate } }),
            Laser.find({ status: 'Disetujui', tanggal_peminjaman: { $gte: startDate, $lte: endDate } }),
            Printing.find({ status: 'Disetujui', tanggal_peminjaman: { $gte: startDate, $lte: endDate } })
        ]);

        const flattenedPeminjaman = approvedPeminjaman.flat().map(p => ({
            id: p._id,
            nama_mesin: p.nama_mesin,
            tanggal_peminjaman: p.tanggal_peminjaman,
            awal_peminjaman: p.awal_peminjaman,
            akhir_peminjaman: p.akhir_peminjaman,
            nama_pemohon: p.nama_pemohon
        }));

        res.status(200).json({
            success: true,
            data: flattenedPeminjaman
        });
    } catch (err) {
        console.error('Error in getApprovedPeminjamanByDate:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

module.exports = {
    getApprovedPeminjaman,
    getApprovedPeminjamanByDate
};