const express = require('express');
const { getPortfolio } = require('../portfolio');

const router = express.Router();

router.get('/portfolio', (req, res) => {
  res.json(getPortfolio());
});

module.exports = router;
