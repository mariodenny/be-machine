// authController
const User = require("../models/userModel");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const crypto = require("crypto");


function logWithTimestamp(message, data = null) {
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
  if (data) {
    console.log(`[${formattedTime}] : ${message}`, data);
  } else {
    console.log(`[${formattedTime}] : ${message}`);
  }
}

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, // use SSL
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD, // Ganti EMAIL_PASS dengan EMAIL_APP_PASSWORD
  },
  tls: {
    rejectUnauthorized: false, // Untuk development
  },
});

// Tambahkan verifikasi transporter
transporter.verify(function (error, success) {
  if (error) {
    logWithTimestamp("SMTP connection error:", error);
  } else {
    logWithTimestamp("SMTP server is ready to take our messages");
  }
});

const sendVerificationEmail = async (user, verificationCode) => {
  try {
    // Verifikasi parameter
    if (!user || !verificationCode) {
      throw new Error("Missing required parameters for email verification");
    }

    // Pastikan URL verifikasi valid
    if (!process.env.FRONTEND_URL) {
      throw new Error("FRONTEND_URL not configured in environment variables");
    }

    // const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;

    // Template email yang lebih informatif
    const mailOptions = {
      from: {
        name: "Peminjaman Mesin Lab", // Sesuaikan dengan nama aplikasi Anda
        address: process.env.EMAIL_USER,
      },
      to: user.email,
      subject: "Verifikasi Email Anda",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Selamat Datang, ${user.username}!</h2>
          <p>Kode verifikasi Anda adalah:</p>
          <h1 style="color: #4CAF50; font-size: 32px; letter-spacing: 5px;">
            ${verificationCode}
          </h1>
          <p>Masukkan kode ini di aplikasi untuk menyelesaikan verifikasi.</p>
          <p>Kode berlaku selama 5 menit.</p>
        </div>
      `,
    };

    // Kirim email dengan logging
    logWithTimestamp(`Attempting to send verification email to: ${user.email}`);
    const info = await transporter.sendMail(mailOptions);
    logWithTimestamp(
      `Verification email sent successfully. MessageId: ${info.messageId}`
    );

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    logWithTimestamp(`Failed to send verification email: ${error.message}`);
    throw new Error(`Failed to send verification email: ${error.message}`);
  }
};

const register = async (req, res) => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const { username, email, password, role } = req.body;

    // Validasi input
    if (!username || !email || !password || !role) {
      logWithTimestamp("Registration failed: Missing required fields");
      return res.status(400).json({
        success: false,
        statusCode: 400,
        message: "Harap lengkapi semua data yang diperlukan",
        missingFields: {
          username: !username,
          email: !email,
          password: !password,
          role: !role,
        },
      });
    }

    // Validasi format email
    const emailRegex = /@gmail\.(com|id)$/i;
    if (!emailRegex.test(email)) {
      logWithTimestamp(`Registration failed: Invalid email format - ${email}`);
      return res.status(400).json({
        success: false,
        statusCode: 400,
        message:
          "Format email tidak valid. Gunakan email Gmail dengan domain .com atau .id",
      });
    }

    // Cek user yang sudah ada
    const existingUser = await User.findOne({ email: email }).session(session);
    if (existingUser) {
      logWithTimestamp(`Registration failed: Email already exists - ${email}`);

      if (existingUser.role !== role) {
        return res.status(400).json({
          success: false,
          statusCode: 400,
          message: `Email ini telah terdaftar sebagai ${existingUser.role}. Tidak dapat mendaftar ulang sebagai ${role}.`,
        });
      }

      return res.status(400).json({
        success: false,
        statusCode: 400,
        message:
          "Email ini telah terdaftar. Silakan gunakan email lain atau lakukan login.",
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashPassword = await bcrypt.hash(password, salt);

    // Generate kode verifikasi 6 digit
    const verificationCode = Math.floor(
      100000 + Math.random() * 900000
    ).toString();
    const verificationCodeExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 menit

    // Buat user baru
    const newUser = await User.create(
      [
        {
          username,
          email,
          password: hashPassword,
          role,
          isVerified: false,
          verificationCode,
          verificationCodeExpires,
        },
      ],
      { session }
    );

    // Commit transaction sebelum mengirim email
    await session.commitTransaction();
    session.endSession();

    // Kirim email verifikasi setelah transaction berhasil
    try {
      logWithTimestamp(`Attempting to send verification email to: ${email}`);
      await sendVerificationEmail(newUser[0], verificationCode);
      logWithTimestamp(`Verification email sent successfully to ${email}`);

      return res.status(201).json({
        success: true,
        message:
          "Pendaftaran berhasil! Silakan cek email Anda untuk verifikasi.",
        email: email,
      });
    } catch (emailError) {
      logWithTimestamp(
        `Warning: User created but email failed to send: ${emailError.message}`
      );

      // Tetap return success karena user sudah terbuat, tapi dengan pesan warning
      return res.status(201).json({
        success: true,
        message:
          "Pendaftaran berhasil, tetapi terjadi masalah dalam pengiriman email verifikasi. Silakan gunakan fitur kirim ulang kode verifikasi.",
        email: email,
      });
    }
  } catch (error) {
    // Rollback transaction jika terjadi error
    await session.abortTransaction();
    session.endSession();

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      const value = error.keyValue[field];
      return res.status(400).json({
        success: false,
        message: `${
          field.charAt(0).toUpperCase() + field.slice(1)
        } "${value}" telah digunakan.`,
      });
    }

    logWithTimestamp(`Registration error: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan saat mendaftar. Silakan coba lagi.",
      error: error.message,
    });
  }
};

const login = async (req, res) => {
  try {
    const { email, password, fcmToken } = req.body;

    const user = await User.findOne({
      email: email,
    });

    if (!email || !password)
      return res.status(400).json({
        success: false,
        statusCode: res.statusCode,
        message: "Harap lengkapi data yang diinput",
      });

    const emailRegex = /@gmail\.(com|id)$/i;
    if (!emailRegex.test(email))
      return res.status(400).json({
        success: false,
        statusCode: res.statusCode,
        message: "Format email tidak valid",
      });

    if (!user)
      return res.status(404).json({
        success: false,
        statusCode: res.statusCode,
        message: "Pengguna tidak ditemukan",
      });

    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: "Akun Anda belum diverifikasi. Silakan cek email Anda.",
      });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(400).json({
        success: false,
        statusCode: res.statusCode,
        message: "Kata sandi salah!",
      });

    const userId = user._id;
    const userName = user.username;
    const emailId = user.email;
    const userRole = user.role;

    // Update FCM token jika ada
    if (fcmToken) {
      user.fcmToken = fcmToken;
      await user.save();
      logWithTimestamp(
        `FCM Token updated during login for user: ${user.email}`
      );
    }

    logWithTimestamp(`User logged in with role: ${userRole}`); // Tambahkan log ini untuk debug
    logWithTimestamp(`User logged in with email: ${emailId}`);

    const accessToken = jwt.sign(
      {
        userId,
        userName,
        emailId,
        userRole,
        // userId: user._id,
        // userName: user.username,
        // emailId: user.email,
        // userRole: user.role
      },
      process.env.ACCESS_TOKEN_SECRET
    );
    const refreshToken = jwt.sign(
      {
        userId,
        userName,
        emailId,
        userRole,
      },
      process.env.REFRESH_TOKEN_SECRET
    );

    await User.updateOne(
      { _id: userId },
      { $set: { refresh_token: refreshToken } }
    );

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      success: true,
      statusCode: res.statusCode,
      message: "Login Success",
      data: {
        userId,
        email,
        userName,
        userRole,
        accessToken,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      statusCode: res.statusCode,
      error: {
        message: "Internal Server Error",
        uri: req.originalUrl,
      },
    });
  }
};

const logout = async (req, res) => {
  try {
    logWithTimestamp("Request body received at backend:", req.body);
    // const userEmail = req.body["email"];
    const userEmail = req.body?.email;
    if (!userEmail) {
      logWithTimestamp("No email provided in request");
      return res.status(400).json({
        success: false,
        message: "Email diperlukan untuk keluar",
      });
    }

    logWithTimestamp(`Attempting to logout user: ${userEmail}`);

    const user = await User.findOne({ email: userEmail });

    if (!user) {
      logWithTimestamp(`User not found for email: ${userEmail}`);
      return res.status(200).json({
        success: true,
        message: "Pengguna sudah keluar",
      });
    }

    logWithTimestamp(
      `User found, clearing refresh token and FCM token for: ${userEmail}`
    );
    user.refresh_token = null;
    user.fcmToken = null;
    await user.save();

    logWithTimestamp("Clearing refresh token cookie");
    res.clearCookie("refreshToken");

    logWithTimestamp("Logout successful");
    res.status(200).json({
      success: true,
      message: "Berhasil logout",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred during logout",
    });
  }
};

const updateFcmToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;
    // const userEmail = req.email; // From verifyToken middleware
    const userEmail = req.user.email; // From verifyToken middleware

    logWithTimestamp("Updating FCM token for user:", userEmail);
    logWithTimestamp("FCM token length:", fcmToken?.length);

    if (!fcmToken) {
      logWithTimestamp("No FCM token provided");
      return res.status(400).json({
        success: false,
        message: "FCM Token required",
      });
    }

    const user = await User.findOne({ email: userEmail });
    if (!user) {
      logWithTimestamp("User not found:", userEmail);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    user.fcmToken = fcmToken;
    await user.save();

    logWithTimestamp("FCM Token updated successfully for:", userEmail);

    res.status(200).json({
      success: true,
      message: "FCM Token updated successfully",
    });
  } catch (error) {
    logWithTimestamp("Error updating FCM token:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update FCM token",
      error: error.message,
    });
  }
};

const verifyEmail = async (req, res) => {
  const { token } = req.query;

  if (!token) {
    logWithTimestamp("Email verification failed: No token provided");
    return res.status(400).json({
      success: false,
      message: "Token verifikasi diperlukan",
    });
  }

  try {
    // Cari user dengan token dan belum diverifikasi
    const user = await User.findOne({
      verificationToken: token,
      isVerified: false,
    });

    if (!user) {
      logWithTimestamp(
        `Email verification failed: Invalid or expired token - ${token}`
      );
      return res.status(400).json({
        success: false,
        message:
          "Token tidak valid atau telah kedaluwarsa. Silakan melakukan registrasi ulang.",
      });
    }

    // Tambahkan timestamp untuk verifikasi
    const verifiedAt = new Date();

    // Update user dengan transaction
    const session = await User.startSession();
    session.startTransaction();

    try {
      // Update status verifikasi user
      await User.findByIdAndUpdate(
        user._id,
        {
          $set: {
            isVerified: true,
            verificationToken: null,
            verifiedAt: verifiedAt,
          },
        },
        { session }
      );

      // Kirim email konfirmasi verifikasi berhasil
      try {
        await transporter.sendMail({
          from: {
            name: "Peminjaman Mesin Lab",
            address: process.env.EMAIL_USER,
          },
          to: user.email,
          subject: "Email Berhasil Diverifikasi",
          html: `
            <div style="font-family: Arial, sans-serif; padding: 20px;">
              <h2>Selamat ${user.username}!</h2>
              <p>Email Anda telah berhasil diverifikasi.</p>
              <p>Anda sekarang dapat login ke aplikasi Peminjaman Mesin Lab.</p>
              <div style="margin: 20px 0;">
                <a href="${process.env.FRONTEND_URL}/login" 
                   style="background-color: #4CAF50; 
                          color: white; 
                          padding: 10px 20px; 
                          text-decoration: none; 
                          border-radius: 5px;">
                  Login Sekarang
                </a>
              </div>
            </div>
          `,
        });

        logWithTimestamp(`Verification success email sent to ${user.email}`);
      } catch (emailError) {
        logWithTimestamp(
          `Failed to send verification success email: ${emailError.message}`
        );
        // Lanjutkan proses meski email konfirmasi gagal
      }

      await session.commitTransaction();
      logWithTimestamp(`Email verified successfully for user: ${user.email}`);

      res.status(200).json({
        success: true,
        message:
          "Email berhasil diverifikasi. Anda sekarang dapat login ke aplikasi.",
        redirectUrl: `${process.env.FRONTEND_URL}/login`,
      });
    } catch (transactionError) {
      await session.abortTransaction();
      throw transactionError;
    } finally {
      session.endSession();
    }
  } catch (error) {
    logWithTimestamp(`Email verification error: ${error.message}`);
    res.status(500).json({
      success: false,
      message:
        "Terjadi kesalahan saat memverifikasi email. Silakan coba lagi nanti.",
      error: error.message,
    });
  }
};

const verifyCode = async (req, res) => {
  try {
    const { email, code } = req.body;

    const user = await User.findOne({
      email,
      verificationCode: code,
      verificationCodeExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Kode verifikasi tidak valid atau telah kadaluarsa",
      });
    }

    user.isVerified = true;
    user.verificationCode = undefined;
    user.verificationCodeExpires = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Email berhasil diverifikasi",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Terjadi kesalahan saat verifikasi",
      error: error.message,
    });
  }
};

const resendVerificationCode = async (req, res) => {
  try {
    const { email } = req.body;

    // Validasi input
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email diperlukan untuk mengirim ulang kode verifikasi",
      });
    }

    // Cari pengguna berdasarkan email
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Pengguna tidak ditemukan",
      });
    }

    // Periksa apakah pengguna sudah diverifikasi
    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Email ini sudah diverifikasi",
      });
    }

    // Generate kode verifikasi baru
    const newVerificationCode = Math.floor(
      100000 + Math.random() * 900000
    ).toString();
    const verificationCodeExpires = new Date(Date.now() + 5 * 60 * 1000); // Kedaluwarsa 5 menit

    // Perbarui pengguna dengan kode baru
    user.verificationCode = newVerificationCode;
    user.verificationCodeExpires = verificationCodeExpires;
    await user.save();

    // Kirim email verifikasi baru
    await sendVerificationEmail(user, newVerificationCode);

    res.status(200).json({
      success: true,
      message: "Kode verifikasi baru telah dikirim ke email Anda",
    });
  } catch (error) {
    logWithTimestamp(`Error resending verification code: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Terjadi kesalahan saat mengirim ulang kode verifikasi",
      error: error.message,
    });
  }
};

module.exports = {
  register,
  login,
  logout,
  updateFcmToken,
  verifyEmail,
  verifyCode,
  resendVerificationCode,
};

// const register = async (req, res) => {
//   try {
//     const { username, email, password, role } = req.body;

//     // Validasi input
//     if (!username || !email || !password || !role) {
//       logWithTimestamp("Registration failed: Missing required fields");
//       return res.status(400).json({
//         success: false,
//         statusCode: 400,
//         message: "Harap lengkapi semua data yang diperlukan",
//         missingFields: {
//           username: !username,
//           email: !email,
//           password: !password,
//           role: !role,
//         },
//       });
//     }

//     // Validasi format email
//     const emailRegex = /@gmail\.(com|id)$/i;
//     if (!emailRegex.test(email)) {
//       logWithTimestamp(`Registration failed: Invalid email format - ${email}`);
//       return res.status(400).json({
//         success: false,
//         statusCode: 400,
//         message:
//           "Format email tidak valid. Gunakan email Gmail dengan domain .com atau .id",
//       });
//     }

//     // Cek user yang sudah ada
//     const existingUser = await User.findOne({ email: email });
//     if (existingUser) {
//       logWithTimestamp(`Registration failed: Email already exists - ${email}`);

//       // Cek jika mencoba mendaftar dengan peran berbeda
//       if (existingUser.role !== role) {
//         return res.status(400).json({
//           success: false,
//           statusCode: 400,
//           message: `Email ini telah terdaftar sebagai ${existingUser.role}. Tidak dapat mendaftar ulang sebagai ${role}.`,
//         });
//       }

//       return res.status(400).json({
//         success: false,
//         statusCode: 400,
//         message:
//           "Email ini telah terdaftar. Silakan gunakan email lain atau lakukan login.",
//       });
//     }

//     // Hash password
//     const salt = await bcrypt.genSalt(10);
//     const hashPassword = await bcrypt.hash(password, salt);

//     // Generate verification token
//     // const token = crypto.randomBytes(32).toString("hex");
//     // logWithTimestamp(`Generated verification token for ${email}`);

//     // Generate kode verifikasi 6 digit
//     const verificationCode = Math.floor(
//       100000 + Math.random() * 900000
//     ).toString();

//     // Tentukan waktu kedaluwarsa kode (5 menit dari sekarang)
//     const verificationCodeExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 menit

//     // Buat user baru dengan session
//     const session = await User.startSession();
//     session.startTransaction();

//     try {
//       // Buat user baru
//       const newUser = await User.create(
//         [
//           {
//             username,
//             email,
//             password: hashPassword,
//             role,
//             isVerified: false,
//             verificationCode,
//             verificationCodeExpires,
//           },
//         ],
//         { session }
//       );

//       // Kirim email verifikasi
//       // Kirim email verifikasi
//       await sendVerificationEmail(newUser[0], verificationCode);

//       // try {
//       //   await sendVerificationEmail(newUser[0], token);
//       //   logWithTimestamp(`Verification email sent successfully to ${email}`);
//       // } catch (emailError) {
//       //   // Jika gagal kirim email, rollback pembuatan user
//       //   await session.abortTransaction();
//       //   logWithTimestamp(
//       //     `Failed to send verification email: ${emailError.message}`
//       //   );
//       //   return res.status(500).json({
//       //     success: false,
//       //     statusCode: 500,
//       //     message: "Gagal mengirim email verifikasi. Silakan coba lagi nanti.",
//       //     error: emailError.message,
//       //   });
//       // }

//       // Commit transaction jika semua berhasil
//       await session.commitTransaction();
//       logWithTimestamp(`User registered successfully: ${email}`);

//       res.status(201).json({
//         success: true,
//         message:
//           "Pendaftaran berhasil! Silakan cek email Anda untuk verifikasi.",
//         email: email,
//       });
//     } catch (transactionError) {
//       // Rollback jika ada error dalam transaction
//       await session.abortTransaction();
//       throw transactionError;
//     } finally {
//       session.endSession();
//     }
//   } catch (error) {
//     // Tangkap error duplicate key MongoDB
//     if (error.code === 11000) {
//       const field = Object.keys(error.keyPattern)[0];
//       const value = error.keyValue[field];
//       return res.status(400).json({
//         success: false,
//         message: `${
//           field.charAt(0).toUpperCase() + field.slice(1)
//         } "${value}" telah digunakan.`,
//       });
//     }

//     // Log error dan respon kesalahan lainnya
//     logWithTimestamp(`Registration error: ${error.message}`);
//     res.status(500).json({
//       success: false,
//       message: "Terjadi kesalahan saat mendaftar. Silakan coba lagi.",
//     });
//   }
// };
// const register = async (req, res) => {
//   const { username, email, password, role } = req.body;

//   const user = await User.findOne({
//     email: email,
//   });

//   if (!username || !email || !password || !role)
//     return res.status(400).json({
//       success: false,
//       statusCode: res.statusCode,
//       message: "Harap lengkapi data yang diinput",
//     });

//   const emailRegex = /@gmail\.(com|id)$/i;
//   if (!emailRegex.test(email))
//     return res.status(400).json({
//       success: false,
//       statusCode: res.statusCode,
//       message: "Format email tidak valid",
//     });

//   try {
//     // Check if user with the given email already exists
//     const existingUser = await User.findOne({ email: email });

//     if (existingUser) {
//       // Check if the user is attempting to register with a different role
//       if (existingUser.role !== role) {
//         return res.status(400).json({
//           success: false,
//           statusCode: res.statusCode,
//           message: `Email Anda telah terdaftar untuk peran ${existingUser.role}. Tidak dapat mendaftar ulang sebagai ${role}.`,
//         });
//       }

//       // If the user already exists with the same role
//       return res.status(400).json({
//         success: false,
//         statusCode: res.statusCode,
//         message: "Email Anda telah terdaftar!",
//       });
//     }
//     // if (user)
//     //   return res.status(400).json({
//     //     success: false,
//     //     statusCode: res.statusCode,
//     //     message: "Email Anda telah terdaftar!",
//     //   });

//     const salt = await bcrypt.genSalt();
//     const hashPassword = await bcrypt.hash(password, salt);
//     // await User.create({
//     //     username: username,
//     //     email: email,
//     //     password: hashPassword,
//     //     role: role
//     // });
//     const newUser = await User.create({
//       username: username,
//       email: email,
//       password: hashPassword,
//       role: role,
//       isVerified: false, // Set default verification status
//     });

//     // Generate verification token
//     const token = crypto.randomBytes(32).toString("hex");
//     // Simpan token ke database atau gunakan model terpisah untuk menyimpan token
//     newUser.verificationToken = token;
//     await newUser.save();

//     // Kirim email verifikasi
//     await sendVerificationEmail(newUser, token);

//     res.status(201).json({
//       success: true,
//       message: "Pendaftaran berhasil. Silakan cek email Anda untuk verifikasi.",
//     });
//   } catch (error) {
//     logWithTimestamp("Error creating user: ${error}", error); // Log the error
//     console.error(`Error creating user: ${error}`);
//     res.status(500).json({
//       success: false,
//       statusCode: res.statusCode,
//       error: {
//         message: error.message,
//         uri: req.originalUrl,
//       },
//     });
//     console.log(error);
//   }
// };