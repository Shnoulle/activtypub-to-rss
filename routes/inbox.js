'use strict';
const express = require('express'),
      crypto = require('crypto'),
      request = require('request'),
      fs = require('fs'),
      router = express.Router();

function signAndSend(message, name, domain, req, res, targetDomain) {
  // get the private key
  let db = req.app.get('db');
  let result = db.prepare('select privkey from accounts where name = ?').get(`${name}@${domain}`);
  if (result === undefined) {
    return res.status(404).send(`No record found for ${name}.`);
  }
  else {
    let privkey = result.privkey;
    const signer = crypto.createSign('sha256');
    let d = new Date();
    let stringToSign = `(request-target): post /inbox\nhost: ${targetDomain}\ndate: ${d.toUTCString()}`;
    signer.update(stringToSign);
    signer.end();
    const signature = signer.sign(privkey);
    const signature_b64 = signature.toString('base64');
    let header = `keyId="https://${domain}/u/${name}",headers="(request-target) host date",signature="${signature_b64}"`;
    console.log('signature:',header);
    request({
      url: `https://${targetDomain}/inbox`,
      headers: {
        'Host': targetDomain,
        'Date': d.toUTCString(),
        'Signature': header
      },
      method: 'POST',
      json: true,
      body: message
    }, function (error, response, body){
    });
    res.json('done');
  }
}

function sendAcceptMessage(thebody, name, domain, req, res, targetDomain) {
  const guid = crypto.randomBytes(16).toString('hex');
  console.log(thebody);
  let message = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    'id': `https://${domain}/${guid}`,
    'type': 'Accept',
    'actor': `https://${domain}/u/${name}`,
    'object': thebody,
  };
  signAndSend(message, name, domain, req, res, targetDomain);
}

router.post('/', function (req, res) {
  // pass in a name for an account, if the account doesn't exist, create it!
  let domain = req.app.get('domain');
  const myURL = new URL(req.body.actor);
  let targetDomain = myURL.hostname;
  fs.appendFile('/home/dariusk/bot-node/inbox.log', JSON.stringify(req.body)+'\r\n', function (err) {
     if (err) {
       return console.log(err);
     }
  });
  // TODO: add "Undo" follow event
  if (typeof req.body.object === 'string' && req.body.type === 'Follow') {
    let name = req.body.object.replace(`https://${domain}/u/`,'');
    sendAcceptMessage(req.body, name, domain, req, res, targetDomain);
    // Add the user to the DB of accounts that follow the account
    let db = req.app.get('db');
    // get the followers JSON for the user
    let result = db.prepare('select followers from accounts where name = ?').get(`${name}@${domain}`);
    if (result === undefined) {
      console.log(`No record found for ${name}.`);
    }
    else {
      // update followers
      let followers = result.followers;
      console.log(followers);
      if (followers) {
        followers.push(req.body.actor);
        // unique items
        followers = [...new Set(followers)];
      }
      else {
        followers = [req.body.actor];
      }
      let followersText = JSON.stringify(followers);
      // update into DB
      db.prepare('update accounts set followers = ? where name = ?').run(`${name}@${domain}`, followersText);
    }
  }
});

module.exports = router;
