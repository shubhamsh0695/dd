/**
 * QueueController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

module.exports = {

  // retrieve the queue that are allowed for the current user
  async find (req, res) {
    const viewAll = req.user.role === sails.config.globals.ROLE_ADMIN ? !!req.query.viewAllQueues : false;
    if (viewAll || req.user.viewAllQueues || req.user.role === sails.config.globals.ROLE_NURSE || req.user.role === sails.config.globals.ROLE_SCHEDULER) {
      const queues = await Queue.find({});
      return res.json(queues);
    }
    if (req.user.allowedQueues && req.user.allowedQueues.length > 0) {
      return res.json(req.user.allowedQueues);
    }
    // if the user have no queue by default he can see alls

    return res.json([]);
  }
};

