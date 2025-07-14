const multer = require("multer");
const path = require("path");
const fs = require("fs");


const uploadPath = path.join(__dirname, "../uploads");

if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath, { recursive: true });
    console.log(`Folder 'uploads/' otomatis dibuat!`);
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "../uploads");
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname);
        cb(null, "image-" + Date.now() + ext);
    }
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
        cb(null, true);
    } else {
        cb(new Error("Only image files are allowed!"), false);
    }
};

const upload = multer({ storage, fileFilter });

module.exports = upload;
