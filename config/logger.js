// config/logger.js

const winston = require('winston');
const path = require('path');

// Custom format untuk timestamp dengan zona waktu Indonesia
const timezoneFormat = () => {
  return new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  });
};

// Format log yang akan digunakan
const logFormat = winston.format.combine(
  winston.format.printf(info => {
    const timestamp = timezoneFormat();
    if (typeof info.message === 'object') {
      return `[${timestamp}] ${info.level.toUpperCase()}: ${JSON.stringify(info.message)}`;
    }
    return `[${timestamp}] ${info.level.toUpperCase()}: ${info.message}`;
  })
);

// Buat folder logs jika belum ada
const fs = require('fs');
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Konfigurasi logger
const logger = winston.createLogger({
  format: logFormat,
  transports: [
    // Log error ke file terpisah
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Log semua level ke file combined
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Log khusus sensor ke file terpisah
    new winston.transports.File({
      filename: path.join(logsDir, 'sensor.log'),
      maxsize: 5242880,
      maxFiles: 5,
    }),
    // Log ke console dengan warna
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      )
    })
  ]
});

// Ganti fungsi console.log standar
console.log = (...args) => logger.info(args.join(' '));
console.error = (...args) => logger.error(args.join(' '));
console.warn = (...args) => logger.warn(args.join(' '));
console.info = (...args) => logger.info(args.join(' '));

module.exports = logger;