import test from 'node:test'
import assert from 'node:assert/strict'
import { readRegistrationRecovery, saveRegistrationRecovery, clearRegistrationRecovery } from '../src/utils/registrationRecovery.js'

test('registration recovery restores only live challenge metadata and never stores secrets', () => {
  const previous = globalThis.sessionStorage
  const data = new Map()
  globalThis.sessionStorage = { getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key) }
  try {
    const saved = saveRegistrationRecovery(' Resident@Example.Invalid ', { challengeId:'75dc4fd6-903f-483a-8100-9fbedb23bc84', expiresAt:new Date(Date.now()+600000).toISOString(),retryAfterSeconds:42,otp:'123456',password:'secret',registrationToken:'secret-token' })
    assert.equal(saved.email,'resident@example.invalid');assert.deepEqual(readRegistrationRecovery(),saved)
    const serialized=[...data.values()][0];assert.doesNotMatch(serialized,/password|secret|123456|registrationToken/)
    assert.ok(saved.retryAt>Date.now()+40000)
    data.set('condo_registration_verification',JSON.stringify({...saved,expiresAt:Date.now()-1}));assert.equal(readRegistrationRecovery(),null);assert.equal(data.size,0)
    for (const invalid of ['{',JSON.stringify({...saved,id:'bad'}),JSON.stringify({...saved,email:'invalid'}),JSON.stringify({...saved,retryAt:null})]) {
      data.set('condo_registration_verification',invalid);assert.equal(readRegistrationRecovery(),null);assert.equal(data.size,0)
    }
    clearRegistrationRecovery();assert.equal(data.size,0)
  } finally {if(previous===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=previous}
})
test('registration verification still works in memory when browser storage is unavailable', () => {
  const previous=globalThis.sessionStorage
  globalThis.sessionStorage={getItem(){throw new Error('denied')},setItem(){throw new Error('denied')},removeItem(){throw new Error('denied')}}
  try {assert.equal(readRegistrationRecovery(),null);assert.doesNotThrow(()=>saveRegistrationRecovery('a@example.invalid',{challengeId:'id',retryAfterSeconds:60}));assert.doesNotThrow(clearRegistrationRecovery)}
  finally {if(previous===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=previous}
})
