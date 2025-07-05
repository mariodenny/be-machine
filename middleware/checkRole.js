// middleware/checkRole.js

const checkRole = (allowedRoles) => {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized - No user found"
        });
      }
  
      const userRole = req.user.role;
      
      if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({
          success: false,
          message: `Forbidden - Required role: ${allowedRoles.join(' or ')}`
        });
      }
  
      next();
    };
  };
  
  module.exports = checkRole;