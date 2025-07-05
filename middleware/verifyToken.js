// const jwt = require("jsonwebtoken");

// const verifyToken = (req, res, next) => {
//     const authHeader = req.headers['authorization'];
//     const token = authHeader && authHeader.split(' ')[1];
//     if(token == null) return res.sendStatus(401);
//     jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (e, decoded)=>{
//         if(e) return res.sendStatus(403);
//         req.email = decoded.email;
//         req.username = decoded;
//         next();
//     })
// }
// module.exports = verifyToken;

// const jwt = require("jsonwebtoken");

// const verifyToken = (req, res, next) => {
//     const authHeader = req.headers['authorization'];
//     const token = authHeader && authHeader.split(' ')[1];
//     if(token == null) return res.sendStatus(401);

//     jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (e, decoded) => {
//         if(e) return res.sendStatus(403);

//         // Pastikan email diambil dari `emailId`
//         req.email = decoded.emailId;
//         req.username = decoded.userName;

//         next();
//     });
// }

// module.exports = verifyToken;

// middleware/verifyToken.js
// middleware/verifyToken.js

// const jwt = require("jsonwebtoken");

// const verifyToken = (req, res, next) => {
//   const authHeader = req.headers["authorization"];
//   const token = authHeader && authHeader.split(" ")[1];

// //   console.log(
// //     "ACCESS_TOKEN_SECRET saat pembuatan token:",
// //     process.env.ACCESS_TOKEN_SECRET
// //   );
// //   console.log(
// //     "ACCESS_TOKEN_SECRET saat verifikasi token:",
// //     process.env.ACCESS_TOKEN_SECRET
// //   );

//   // Log Authorization Header dan Extracted Token untuk debugging
// //   console.log("Authorization Header:", authHeader);
// //   console.log("Extracted Token:", token);

//   if (!authHeader) {
//     return res.status(401).json({
//       success: false,
//       message: "Authorization header missing",
//     });
//   }

//   if (!token) {
//     return res.status(401).json({
//       success: false,
//       message: "No token provided",
//     });
//   }

//   try {
//     const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

//     // Set seluruh informasi user ke req.user
//     req.user = {
//       userId: decoded.userId,
//       email: decoded.emailId,
//       username: decoded.userName,
//       role: decoded.userRole,
//     };

//     // Log untuk debugging
//     // console.log("Token verified for user:", {
//     //   userId: req.user.userId,
//     //   email: req.user.email,
//     //   role: req.user.role,
//     // });

//     next();
//   } catch (error) {
//     console.error("Token verification failed:", error);
//     return res.status(403).json({
//       success: false,
//       message: "Invalid or expired token",
//     });
//   }
// };

// module.exports = verifyToken;

// middleware/verifyToken.js
// const jwt = require("jsonwebtoken");

// const verifyToken = (req, res, next) => {
//     const authHeader = req.headers['authorization'];
//     const token = authHeader && authHeader.split(' ')[1];
    
//     if (!token) {
//         return res.status(401).json({
//             success: false,
//             message: "No token provided"
//         });
//     }

//     try {
//         const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
        
//         // Log decoded token untuk debugging
//         // console.log('Decoded token:', decoded);
        
//         // Set user info ke req.user
//         req.user = {
//             userId: decoded.userId,
//             email: decoded.emailId,
//             username: decoded.userName,
//             role: decoded.userRole
//         };

//         // console.log('User info set in request:', req.user);
        
//         next();
//     } catch (error) {
//         console.error('Token verification failed:', error);
//         return res.status(403).json({
//             success: false,
//             message: "Invalid or expired token"
//         });
//     }
// };

// module.exports = verifyToken;

// middleware/verifyToken.js
const jwt = require("jsonwebtoken");

const verifyToken = (req, res, next) => {
    try {
        // Log header untuk debugging
        // console.log('Authorization header:', req.headers['authorization']);
        
        const authHeader = req.headers['authorization'];
        
        // Validasi format header
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log('Invalid authorization header format');
            return res.status(401).json({
                success: false,
                message: "Invalid authorization header format"
            });
        }

        // Extract dan validasi token
        const token = authHeader.split(' ')[1];
        if (!token || token === 'null' || token === 'undefined') {
            console.log('Invalid token value:', token);
            return res.status(401).json({
                success: false,
                message: "Invalid token value"
            });
        }

        // Log token untuk debugging (hanya sebagian)
        // console.log('Token (first 20 chars):', token.substring(0, 20));
        // console.log('ACCESS_TOKEN_SECRET exists:', !!process.env.ACCESS_TOKEN_SECRET);

        // Verify token
        const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
        
        // Log decoded data
        // console.log('Decoded token:', {
        //     userId: decoded.userId,
        //     email: decoded.emailId,
        //     role: decoded.userRole
        // });

        // Set user info
        req.user = {
            userId: decoded.userId,
            email: decoded.emailId,
            username: decoded.userName,
            role: decoded.userRole
        };

        // console.log('User info set:', req.user);
        next();

    } catch (error) {
        console.error('Token verification failed:', {
            error: error.message,
            name: error.name,
            stack: error.stack
        });

        // Specific error messages based on error type
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: "Invalid token format",
                error: error.message
            });
        } else if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: "Token expired",
                error: error.message
            });
        }

        return res.status(403).json({
            success: false,
            message: "Token verification failed",
            error: error.message
        });
    }
};

module.exports = verifyToken;