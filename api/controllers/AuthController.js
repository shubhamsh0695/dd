/**
 * AuthController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

const bodyParser = require("body-parser");
const passport = require("passport");
const { samlStrategy } = require("../../config/passport");
const jwt = require("jsonwebtoken");

const SMS_CODE_LIFESPAN = 5 * 60;

function generateVerificationCode() {
  const possible = "0123456789";
  let string = "";
  for (let i = 0; i < 6; i++) {
    string += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return string;
}

const canLoginLocal = async (req) => {
  if (
    process.env.LOGIN_METHOD === "password" ||
    process.env.LOGIN_METHOD === "both"
  ) {
    return true;
  }
  if (req.user && req.user.role === "doctor") {
    return false;
  } else if (req.body.email) {
    const isDoctor = await User.count({
      email: req.body.email,
      role: "doctor",
    });
    return !isDoctor;
  } else if (typeof req.body.user === "string") {
    const isDoctor = await User.count({ id: req.body.user, role: "doctor" });
    return !isDoctor;
  }
  return false;
};
module.exports = {
  // login using client certificate
  loginCert(req, res) {
    // return res.status(401).send()
    passport.authenticate("trusted-header", async (err, user, info = {}) => {
      if (err || !user) {
        return res.send({
          message: info.message,
          user,
        });
      }
      try {
        await User.updateOne({ id: user.id }).set({ lastLoginType: "sslcert" });
      } catch (error) {
        console.log("error Updating user login type ", error);
      }
      req.logIn(user, function (err) {
        if (err) {
          console.log("Error login in ", err);
          return res.status(500).send();
        }
        return res.json({
          message: info.message,
          user,
        });
      });
    })(req, res, (err) => {
      console.log("Error with LOGIN CERT", err);
    });
  },

  async loginInvite(req, res) {
    const invite = await PublicInvite.findOne({
      or: [
        { inviteToken: req.body.inviteToken },
        { expertToken: req.body.inviteToken },
      ],
    });
    const isExpert = invite.expertToken === req.body.inviteToken;

    passport.authenticate("invite", async (err, user) => {
      if (err || !user) {
        return res.status(401).send({
          err,
        });
      }

      try {
        await User.updateOne({ id: user.id }).set({ lastLoginType: "invite" });
      } catch (error) {
        console.log("error Updating user login type ", error);
      }

      req.logIn(user, function (err) {
        req.session.cookie.expires = 7 * 24 * 60 * 50 * 1000;
        if (err) {
          console.log("Error login in ", err);
          return res.status(500).send();
        }

        const { token, refreshToken } = TokenService.generateToken(user);
        user.token = token;
        user.refreshToken = refreshToken;

        return res.json({
          user,
        });
      });
    })(req, res, (err) => {
      console.log("error Login invite ", err);
    });
  },

  async forgotPassword(req, res) {
    try {
      User.validate("email", req.body.email);
    } catch (error) {
      return res.status(401).json({ message: "Email is invalid" });
    }

    const db = User.getDatastore().manager;
    const userCollection = db.collection("user");
    const user = (
      await userCollection
        .find({
          email: req.body.email,
          role: { $in: ["admin", "doctor", "nurse"] },
        })
        .collation({ locale: "en", strength: 1 })
        .limit(1)
        .toArray()
    )[0];

    const resetPasswordToken = jwt.sign(
      { email: req.body.email.toLowerCase() },
      sails.config.globals.APP_SECRET,
      { expiresIn: SMS_CODE_LIFESPAN }
    );

    // Always return success directly, so an attacker could not guess if the email exists or not...
    res.json({
      success: true,
    });

    if (user) {
      await db.collection("user").updateOne(
        {
          _id: user._id,
        },
        {
          $set: {
            resetPasswordToken,
          },
        }
      );

      const url = `${process.env.DOCTOR_URL}/app/reset-password?token=${resetPasswordToken}`;
      const doctorLanguage =
        user.preferredLanguage || process.env.DEFAULT_DOCTOR_LOCALE;
      await sails.helpers.email.with({
        to: user.email,
        subject: sails._t(doctorLanguage, "forgot password email subject", {
          url,
        }),
        text: sails._t(doctorLanguage, "forgot password email", { url }),
      });
    }
  },

  async resetPassword(req, res) {
    const passwordFormat = new RegExp(
      "^(((?=.*[a-z])(?=.*[A-Z]))|((?=.*[a-z])(?=.*[0-9]))|((?=.*[A-Z])(?=.*[0-9])))(?=.{6,})"
    );

    if (!req.body.token) {
      return res.status(400).json({
        message: "token-missing",
      });
    }

    if (!passwordFormat.test(req.body.password)) {
      return res.status(400).json({
        message: "password-too-weak",
      });
    }

    try {
      // const decoded = jwt.verify(req.body.token, sails.config.globals.APP_SECRET);

      const password = await User.generatePassword(req.body.password);

      const user = await User.findOne({ resetPasswordToken: req.body.token });
      await User.updateOne({
        resetPasswordToken: req.body.token,
      }).set({
        password,
        resetPasswordToken: "",
      });
      console.log("GOT USER", user);

      if (!user) {
        throw new Error("token-expired");
      }
    } catch (err) {
      console.log("ERROR", err);
      if (err.name == "TokenExpiredError") {
        return res.status(400).json({
          message: "token-expired",
        });
      } else {
        return res.status(400).json({
          message: "unknown",
        });
      }
    }

    res.json({
      success: true,
    });
  },

  // used only for admin
  async loginLocal(req, res) {
    console.log("shubam",res)
    const { locale } = req.headers || {};
    const isLoginLocalAllowed = await canLoginLocal(req);
    if (!isLoginLocalAllowed) {
    console.log("shubam 1")

      return res.status(400).json({
        message: sails._t(locale, "password login is disabled"),
      });
    }

    const isAdmin = await User.count({ email: req.body.email, role: "admin" });
    if (req.body._version) {
      await User.updateOne({
        email: req.body.email,
        role: { in: ["doctor", "admin"] },
      }).set({ doctorClientVersion: req.body._version });
    } else {
      if (!isAdmin) {
        await User.updateOne({
          email: req.body.email,
          role: { in: ["doctor", "admin"] },
        }).set({ doctorClientVersion: "invalid" });
        // return res.status(400).json({
        //   message: 'Le cache de votre navigateur n\'est pas à jour, vous devez le raffraichir avec CTRL+F5 !'
        // });
      }
    }

    passport.authenticate("local", async (err, user, info = {}) => {
      console.log("Authenticate now", err, user);
      if (err) {
        return res.status(500).json({
          message: info.message || sails._t(locale, "server error"),
        });
      }
      if (!user) {
        return res.status(400).json({
          message: info.message,
          user,
        });
      }

      try {
        await User.updateOne({ id: user.id }).set({ lastLoginType: "local" });
      } catch (error) {
        console.log("error Updating user login type ", error);
      }

      // factor one
      if (
        process.env.NODE_ENV !== "development" &&
        user.role === "doctor"
        // || user.role === 'admin'
      ) {
        const localLoginDetails = {
          id: user.id,
          localLoginToken: true,
          singleFactor: true,
        };
        const localLoginToken = jwt.sign(
          localLoginDetails,
          sails.config.globals.APP_SECRET
        );

        let verificationCode;
        if (user.smsVerificationCode) {
          try {
            const decoded = jwt.verify(
              user.smsVerificationCode,
              sails.config.globals.APP_SECRET
            );
            verificationCode = decoded.code;
          } catch (error) {
            console.error(error);
          }
        }
        verificationCode = verificationCode || generateVerificationCode();
        // const salt = await bcrypt.genSalt(10)
        // const hash = await bcrypt.hash(verificationCode, salt)
        const smsToken = jwt.sign(
          { code: verificationCode },
          sails.config.globals.APP_SECRET,
          { expiresIn: SMS_CODE_LIFESPAN }
        );

        await User.updateOne({ id: user.id }).set({
          smsVerificationCode: smsToken,
          smsAttempts: 0,
        });

        try {
          await sails.helpers.sms.with({
            phoneNumber: user.authPhoneNumber,
            message: `Votre code de vérification est ${verificationCode}. Ce code est utilisable ${
              SMS_CODE_LIFESPAN / 60
            } minutes`,
            senderEmail: user?.email
          });
        } catch (err) {
          return res.status(500).json({
            message: "Echec d'envoi du SMS",
          });
        }

        return res.status(200).json({
          localLoginToken,
          user: user.id,
        });
      } else {
        if (user.smsVerificationCode) {
          delete user.smsVerificationCode;
        }

        req.logIn(user, function (err) {
          if (err) {
            console.log("Error login in ", err);
          }
          return res.status(200).send({
            message: info.message,
            user,
          });
        });
      }
    })(req, res, (err) => {
      console.log("Error with LOGIN ", err);
    });
  },

  // used only for admin
  loginSms(req, res) {
    passport.authenticate("sms", async (err, user, info = {}) => {
      console.log("Authenticate now", err, user);
      if (err) {
        return res.status(500).json({
          message: info.message || "Server Error",
        });
      }
      if (!user) {
        return res.status(400).json({
          message: info.message,
          user,
        });
      }

      await User.updateOne({ id: user.id }).set({ smsVerificationCode: "" });

      const localLoginDetails = {
        id: user.id,
        smsToken: true,
        singleFactor: true,
      };
      const smsLoginToken = jwt.sign(
        localLoginDetails,
        sails.config.globals.APP_SECRET
      );
      return res.status(200).json({
        smsLoginToken,
        user: user.id,
      });
    })(req, res, (err) => {
      console.log("Error with LOGIN ", err);
    });
  },

  login2FA(req, res) {
    passport.authenticate("2FA", (err, user, info = {}) => {
      console.log("Authenticate now", err, user);
      if (err) {
        return res.status(500).json({
          message: info.message || "Server Error",
        });
      }
      if (!user) {
        return res.status(400).json({
          message: info.message,
          user,
        });
      }

      req.logIn(user, function (err) {
        if (err) {
          console.log("Error login in ", err);
          return res.status(500).send();
        }
        return res.status(200).send({
          message: info.message,
          user,
        });
      });
    })(req, res, (err) => {
      console.log("Error with LOGIN ", err);
    });
  },

  refreshToken: async function(req, res) {
    const refreshToken = req.body.refreshToken;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    try {
      const decoded = await TokenService.verifyToken(refreshToken, true);
      const user = await User.findOne({ id: decoded.id });
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      const tokens = TokenService.generateToken(user);
      return res.json(tokens);
    } catch (error) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
  },

  verifyRefreshToken: async function(req, res) {
    const refreshToken = req.body.refreshToken;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    try {
      const decoded = await TokenService.verifyToken(refreshToken, true);
      return res.status(200).json({ message: 'Token is valid' });
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired' });
      } else if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: 'Invalid refresh token' });
      } else {
        throw error;
      }
    }
  },


  logout(req, res) {
    const performLogout = () => {
      req.logout((err) => {
        if (err) {
          console.error("Error during req.logout", err);
          return res.status(500).send();
        }
        req.session.destroy((err) => {
          if (err) {
            console.error("Error destroying session", err);
            return res.status(500).send();
          }
          res.status(200).send();
        });
      });
    };

    if ((process.env.LOGIN_METHOD === "saml" || process.env.LOGIN_METHOD === "both") && process.env.LOGOUT_URL) {
      try {
        samlStrategy.logout(req, (err) => {
          if (err) {
            console.error("Error logging out from SAML", err);
            return performLogout();
          }
          console.log("SAML logged out");
          performLogout();
        });
      } catch (error) {
        console.error("Error logging out from SAML", error);
        performLogout();
      }
    } else {
      performLogout();
    }
  },

  /**
   *
   * @param {*} req
   * @param {*} res
   *
   * get user from session or token
   */
  async getCurrentUser(req, res) {
    if (!req.user && !req.headers["x-access-token"] && !req.query.token) {
      return res.notFound();
    }

    if (req.headers["x-access-token"] || req.query.token) {
      jwt.verify(
        req.headers["x-access-token"] || req.query.token,
        sails.config.globals.APP_SECRET,
        async (err, decoded) => {
          if (err) {
            console.error("error ", err);
            return res.status(401).json({ error: "Unauthorized" });
          }

          if (decoded.singleFactor) {
            return res.status(401).json({ error: "Unauthorized" });
          }

          try {
            if (req.query._version) {
              await User.updateOne({
                id: decoded.id,
                email: decoded.email,
                role: { in: ["doctor", "admin"] },
              }).set({ doctorClientVersion: req.query._version });
            } else {
              await User.updateOne({
                id: decoded.id,
                email: decoded.email,
                role: {
                  in: ["doctor", "admin"],
                },
              }).set({
                doctorClientVersion: "invalid",
              });
              // return res.status(400).json({
              //   message: 'Le cache de votre navigateur n\'est pas à jour, vous devez le raffraichir avec CTRL+F5 !'
              // });
            }

            const user = await User.findOne({
              id: decoded.id,
            });

            if (!user) {
              console.error("No user from a valid token ");
              return res.status(500).json({ message: "UNKNOWN ERROR" });
            }

            if (user.role === "doctor") {
              if (!user.doctorClientVersion) {
                return res.status(401).json({
                  error: "Unauthorized App version needs to be updated",
                });
              }
            }

            const { token, refreshToken } = TokenService.generateToken(user);
            user.token = token;
            user.refreshToken = refreshToken;
            if (!req.user) {
              req.logIn(user, function (err) {
                if (err) {
                  console.log("Error login in ", err);
                  return res.status(500).send();
                }
                res.json({
                  user,
                });
              });
            } else {
              res.json({
                user,
              });
            }
          } catch (error) {
            console.error(error);
            res.status(500).json({ message: "UNKNOWN ERROR" });
          }
        }
      );
    } else {
      const user = Object.assign({}, req.user);

      const { token, refreshToken } = TokenService.generateToken(user);

      user.token = token;
      user.refreshToken = refreshToken;

      return res.json({ user });
    }
  },

  loginSaml(req, res) {
    if (
      !process.env.LOGIN_METHOD ||
      (process.env.LOGIN_METHOD !== "saml" &&
        process.env.LOGIN_METHOD !== "both")
    ) {
      console.log("SAML login is disabled");
      return res.status(500).json({
        message: "SAML login is disabled",
      });
    }

    passport.authenticate("saml", { failureRedirect: "/app/login" })(
      req,
      res,
      (err) => {
        if (err) {
          console.log("Error with SAML ", err);
          // res.serverError();
          return res.view("pages/error", {
            error: err,
          });
        }
      }
    );
  },

  samlCallback(req, res) {
    if (
      !process.env.LOGIN_METHOD ||
      (process.env.LOGIN_METHOD !== "saml" &&
        process.env.LOGIN_METHOD !== "both")
    ) {
      console.log("SAML login is disabled");
      return res.status(500).json({
        message: "SAML login is disabled",
      });
    }

    bodyParser.urlencoded({ extended: false })(req, res, () => {
      passport.authenticate("saml", async (err, user, info = {}) => {
        if (err) {
          sails.log("error authenticating ", err);
          return res.view("pages/error", {
            error: err,
          });
        }
        if (!user) {
          return res.json({
            message: info.message,
            user,
          });
        }

        try {
          await User.updateOne({ id: user.id }).set({ lastLoginType: "saml" });
        } catch (error) {
          console.log("error Updating user login type ", error);
        }

        return res.redirect(`/app?tk=${user.token}`);
      })(req, res, (err) => {
        if (err) {
          sails.log("error authenticating ", err);
          return res.view("pages/error", {
            error: err,
          });
        }
        res.redirect("/app/login");
      });
    });
  },

  loginOpenId(req, res, next) {
    if (req.query.role === sails.config.globals.ROLE_DOCTOR) {
      passport.authenticate("openidconnect_doctor")(req, res, next);
    }
    if (req.query.role === sails.config.globals.ROLE_ADMIN) {
      passport.authenticate("openidconnect_admin")(req, res, next);
    }
    if (req.query.role === sails.config.globals.ROLE_NURSE) {
      passport.authenticate("openidconnect_nurse")(req, res, next);
    }
  },

  loginOpenIdReturn(req, res) {
    bodyParser.urlencoded({ extended: false })(req, res, () => {
      if (req.query.role === sails.config.globals.ROLE_ADMIN) {
        passport.authenticate(
          "openidconnect_admin",
          async (err, user, info = {}) => {
            if (err) {
              sails.log("error authenticating ", err);
              return res.view("pages/error", {
                error: err,
              });
            }
            if (!user) {
              return res.status(403).json({
                message: info.message,
                user,
              });
            }
            if (user.role === sails.config.globals.ROLE_ADMIN) {
              if (process.env.NODE_ENV === 'development') {
                return res.redirect(
                  `${process.env["ADMIN_URL"]}/login?tk=${user.token}`
                );
              } else {
                return res.redirect(
                  `/login?tk=${user.token}`
                );
              }
            }
          }
        )(req, res, (err) => {
          if (err) {
            sails.log("error authenticating ", err);
            return res.view("pages/error", {
              error: err,
            });
          }
        });
      }

      if (req.query.role === sails.config.globals.ROLE_NURSE) {
        passport.authenticate(
          "openidconnect_nurse",
          async (err, user, info = {}) => {
            if (err) {
              sails.log("error authenticating ", err);
              return res.view("pages/error", {
                error: err,
              });
            }
            if (!user) {
              return res.status(403).json({
                message: info.message,
                user,
              });
            }
            if (user.role === sails.config.globals.ROLE_NURSE) {
              if (process.env.NODE_ENV === 'development') {
                return res.redirect(
                  `${process.env["PUBLIC_URL"]}/requester?tk=${user.token}`
                );
              } else {
                return res.redirect(
                  `/requester?tk=${user.token}`
                );
              }
            }
          }
        )(req, res, (err) => {
          if (err) {
            sails.log("error authenticating ", err);
            return res.view("pages/error", {
              error: err,
            });
          }
        });
      }

      if (req.query.role === sails.config.globals.ROLE_DOCTOR) {
        passport.authenticate(
          "openidconnect_doctor",
          async (err, user, info = {}) => {
            if (err) {
              sails.log("error authenticating ", err);
              return res.view("pages/error", {
                error: err,
              });
            }
            if (!user) {
              return res.json({
                message: info.message,
                user,
              });
            }

            try {
              await User.updateOne({ id: user.id }).set({
                lastLoginType: "openidconnect",
              });
            } catch (error) {
              console.log("error Updating user login type ", error);
            }

            if (
              user.role === sails.config.globals.ROLE_DOCTOR ||
              user.role === sails.config.globals.ROLE_ADMIN
            ) {
              if (process.env.NODE_ENV === 'development') {
                return res.redirect(
                  `${process.env["DOCTOR_URL"]}/app?tk=${user.token}`
                );
              } else {
                return res.redirect(
                  `/app?tk=${user.token}`
                );
              }
            }
          }
        )(req, res, (err) => {
          if (err) {
            sails.log("error authenticating ", err);
            return res.view("pages/error", {
              error: err,
            });
          }
        });
      }
    });
  },

  metadata(req, res) {
    res.send(
      samlStrategy.generateServiceProviderMetadata(
        process.env.SAML_CERT,
        process.env.SAML_CERT
      )
    );
  },

  getConfig(req, res) {
    res.json({
      method: process.env.LOGIN_METHOD ? process.env.LOGIN_METHOD : "both",
      branding: process.env.BRANDING || "@HOME",
      appleStoreUrl: process.env.APPLE_STORE_URL,
      appleStoreTitle: process.env.APPLE_STORE_TITLE,
      androidStoreUrl: process.env.ANDROID_STORE_URL,
      androidStoreTitle: process.env.ANDROID_STORE_TITLE,
      logo: process.env.LOGO,
      doctorAppPrimaryColor: process.env.DOCTOR_APP_PRIMARY_COLOR,
      nurseExternalLink: process.env.NURSE_EXTERNAL_LINK,
      doctorExternalLink: process.env.DOCTOR_EXTERNAL_LINK,
      patientAppPrimaryColor: process.env.PATIENT_APP_PRIMARY_COLOR,
      openIdLogoutUri: process.env.OPENID_LOGOUT_URL,
      accessibilityMode: process.env.ACCESSIBILITY_MODE,
      matomoUrl: sails.config.globals.MATOMO_URL,
      matomoId: sails.config.globals.MATOMO_ID,
      extraMimeTypes: !!sails.config.globals.EXTRA_MIME_TYPES,
      metadata: process.env.DISPLAY_META
        ? process.env.DISPLAY_META.split(",")
        : "", //! sending metadata to the front in config
    });
  },
  externalAuth(req, res) {
    const { token } = req.query;
    if (!token) {
      return res.badRequest();
    }
    console.log(5555555);
    jwt.verify(
      token,
      process.env.SHARED_EXTERNAL_AUTH_SECRET,
      async (err, decoded) => {
        if (err) {
          console.log("error ", err);
          return res.status(401).json({ error: "Unauthorized" });
        }

        // Check if timestamp is no more than 5 minutes old
        if (!decoded.timestamp) {
          return res.status(401).json({ error: "Timestamp is required" });
        }
        try {
          var now = new Date();
          timestamp = new Date(decoded.timestamp * 1000);
          var FIVE_MIN = 5 * 60 * 1000;

          if (now - timestamp > FIVE_MIN) {
            return res
              .status(401)
              .json({ error: "Timestamp is older than 5 minutes" });
          }
        } catch (error) {
          console.log("error ", error);
          return res.status(500).json({ error: "Unexpected error" });
        }

        if (!decoded.email) {
          return res.status(401).json({ error: "Email is required" });
        }
        try {
          let user = await User.findOne({
            email: decoded.email,
            role: "doctor",
          });
          if (!user) {
            user = await User.create({
              email: decoded.email,
              firstName: decoded.firstName,
              lastName: decoded.lastName,
              phoneNumber: decoded.phoneNumber,
              notifPhoneNumber: decoded.notifPhoneNumber,
              preferredLanguage:
                decoded.preferredLanguage || process.env.DEFAULT_DOCTOR_LOCALE,
              role: "doctor",
            }).fetch();
          }

          const { token } = TokenService.generateToken(user);

          return res.redirect(
            `${process.env.DOCTOR_URL}/app?tk=${token}${
              req.query.returnUrl ? `&returnUrl=${req.query.returnUrl}` : ""
            }`
          );
        } catch (error) {
          console.log("error ", error);
          return res.status(500).json({ error: "Unexpected error" });
        }
      }
    );
  },
};
