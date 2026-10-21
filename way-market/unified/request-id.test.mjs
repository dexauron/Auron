import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {newRequestId} from './workspace/workspace/request-id.mjs';

test('request IDs use native UUID when present and preserve provider binding',()=>{
 const provider={sentinel:'native-id',randomUUID(){return this.sentinel;},getRandomValues(){throw Error('unexpected fallback');}};
 assert.equal(newRequestId(provider),'native-id');
});
test('fallback produces UUID v4 from getRandomValues without randomUUID',()=>{
 const provider={getRandomValues(bytes){bytes.fill(255);return bytes;}};
 assert.equal(newRequestId(provider),'ffffffff-ffff-4fff-bfff-ffffffffffff');
 const secure={getRandomValues:webcrypto.getRandomValues.bind(webcrypto)},ids=new Set();
 for(let i=0;i<1000;i++){const id=newRequestId(secure);assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);ids.add(id);}
 assert.equal(ids.size,1000);
});
test('absence or failure of secure randomness fails rather than silently using weak IDs',()=>{
 assert.throws(()=>newRequestId({}),/безопасные идентификаторы/);
 assert.throws(()=>newRequestId(null),/безопасные идентификаторы/);
 assert.throws(()=>newRequestId({getRandomValues(){throw Error('entropy unavailable');}}),/entropy unavailable/);
});
