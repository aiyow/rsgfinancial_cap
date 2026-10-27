import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registrationHash,
  registrationOtpMatches,
  createRegistrationOtp,
  createRegistrationToken,
} from "../services/accounts.js";
import { createEmailVerificationService } from "../services/email.js";

test('registration codes and grants are random, purpose-bound, email-bound and stored as keyed hashes',()=>{
 const before=process.env.JWT_SECRET;process.env.JWT_SECRET='registration-unit-test';
 try {
  assert.match(createRegistrationOtp(),/^\d{6}$/);assert.match(createRegistrationToken(),/^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(createRegistrationToken(),createRegistrationToken());
  const email='a@example.invalid',id='challenge',code='012345';
  const challenge={id,otp_hash:registrationHash('otp',id,email,code)};
  assert.equal(registrationOtpMatches(challenge,email,code),true);
  assert.equal(registrationOtpMatches(challenge,'b@example.invalid',code),false);
  assert.equal(registrationOtpMatches({...challenge,id:'other'},email,code),false);
  assert.equal(registrationOtpMatches(challenge,email,'111111'),false);
  assert.equal(registrationOtpMatches({...challenge,otp_hash:null},email,code),false);
  assert.notEqual(registrationHash('otp',id,email,code),registrationHash('grant',email,code));
 } finally {if(before===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=before;}
});
test('registration email explains OTP expiry and never sends a password or activation shortcut',async()=>{
 const messages=[];
 const service=createEmailVerificationService({environment:{SMTP_HOST:'smtp.invalid',SMTP_USER:'user',SMTP_PASSWORD:'secret',SMTP_FROM:'test@example.invalid'},
 createTransport:()=>({sendMail:async message=>messages.push(message)})});
 await service.sendRegistrationCode({email:'resident@example.invalid',otp:'012345'});
 assert.equal(messages[0].to,'resident@example.invalid');assert.match(messages[0].text,/012345/);assert.match(messages[0].text,/10 minutes/);
 assert.doesNotMatch(messages[0].text,/verify-email\?token|password is/i);
});
