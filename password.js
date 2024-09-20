const bcrypt = require('bcrypt');

bcrypt.hash('admin', 10, function(err, hash) {
  if(err) console.log(err)
  console.log(hash);
});