/**
 * UserController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */
const validator = require("validator");

module.exports = {
  ip(req, res) {
    res.json({ ip: req.ip });
  },

  async addDoctorToQueue(req, res) {
    if (!req.body.queue) {
      return res.status(400).json({ message: "queue is required" });
    }

    await User.addToCollection(
      req.params.user,
      "allowedQueues",
      req.body.queue
    );

    return res.status(200).json({ success: true });
  },

  async removeDoctorFromQueue(req, res) {
    if (!req.body.queue) {
      return res.status(400).json({ message: "queue is required" });
    }

    try {
      const userAndQueueExist = await User.findOne({
        id: req.params.user,
      }).populate("allowedQueues", { id: req.body.queue });

      if (!userAndQueueExist) {
        res.status(404);
        return res.json({ message: "User not found" });
      } else if (userAndQueueExist.allowedQueues.length === 0) {
        res.status(404);
        return res.json({ message: "Queue not found" });
      }

      await User.removeFromCollection(
        req.params.user,
        "allowedQueues",
        req.body.queue
      );

      return res.status(200).json({ success: true });
    } catch (err) {
      return res.badRequest(err);
    }
  },

  async getDoctorQueues(req, res) {
    const user = await User.findOne({ id: req.params.user }).populate(
      "allowedQueues"
    );

    return res.status(200).json(user.allowedQueues);
  },

  async getUser(req, res) {
    const user = await User.findOne({ id: req.params.user });
    return res.status(200).json(user);
  },

  registerNurse: async function (req, res) {
    try {
      const email = validator.normalizeEmail(req.body.email, {
        gmail_remove_dots: false,
      });
      // const email = validator.normalizeEmail(req.body.email);

      const firstName = validator.escape(req.body.firstName).trim();
      const lastName = validator.escape(req.body.lastName).trim();
      const phoneNumber = validator.escape(req.body.phoneNumber).trim();
      const organization = validator.escape(req.body.organization).trim();
      const country = validator.escape(req.body.country).trim();
      const sex = validator.escape(req.body.sex).trim();

      if (!validator.isEmail(email)) {
        return res.badRequest({ error: "Invalid email address." });
      }

      const existingUser = await User.findOne({
        email,
        role: sails.config.globals.ROLE_NURSE,
      });
      if (existingUser) {
        return res.badRequest({ error: "Email already in use." });
      }

      const newUser = await User.create({
        email,
        firstName,
        lastName,
        phoneNumber,
        organization,
        country,
        sex,
        role: sails.config.globals.ROLE_NURSE,
        status: "not-approved",
      }).fetch();

      return res.ok(newUser);
    } catch (error) {
      return res.serverError(error);
    }
  },

  async updateNotif(req, res) {
    const valuesToUpdate = {};
    if (req.body.enableNotif !== undefined) {
      valuesToUpdate.enableNotif = req.body.enableNotif;
    }
    if (req.body.notifPhoneNumber) {
      valuesToUpdate.notifPhoneNumber = req.body.notifPhoneNumber;
    }
    const user = await User.updateOne({ id: req.user.id }).set(valuesToUpdate);
    return res.status(200).json({ success: true });
  },

  updateStatus: async function (req, res) {
    try {
      const userId = validator.escape(req.param("id")).trim();
      const newStatus = req.body.status;

      if (!["approved", "not-approved"].includes(newStatus)) {
        return res.badRequest({ error: "Invalid status value." });
      }

      const user = await User.findOne({ id: userId });
      if (!user) {
        return res.notFound({ error: "User not found." });
      }

      const updatedUser = await User.updateOne({ id: userId }).set({
        status: newStatus,
      });

      return res.ok(updatedUser);
    } catch (error) {
      return res.serverError(error);
    }
  },

  // async count(req, res){
  //   let count
  //   if(req.query.where){

  //     try {
  //       count = await User.count( {where: JSON.parse(req.query.where)})
  //     } catch (error) {
  //       return res.status(400).json({
  //         success: false,
  //         error
  //       })
  //     }
  //   }else{
  //     count = await User.count( {})
  //   }
  //   return res.status(200).json({
  //     count
  //   })
  // }
};
