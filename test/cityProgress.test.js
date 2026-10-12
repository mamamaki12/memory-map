import {test} from 'node:test';
import assert from 'node:assert/strict';
import {geometryContains,indexCities,computeProgress} from '../src/cityProgress.js';
const polygon={type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[2,1],[2,2],[1,2],[1,1]]]};
const city={type:'Feature',properties:{code:'01',name:'試験市',prefecture:'試験県'},geometry:polygon};
test('polygon classification respects holes and includes outer boundary',()=>{
 assert.equal(geometryContains(polygon,3,3),true);assert.equal(geometryContains(polygon,1.5,1.5),false);assert.equal(geometryContains(polygon,5,5),false);assert.equal(geometryContains(polygon,0,0),true);
});
test('multipolygon recognises detached islands',()=>{
 assert.equal(geometryContains({type:'MultiPolygon',coordinates:[polygon.coordinates,[[[10,10],[11,10],[11,11],[10,11],[10,10]]]]},10.5,10.5),true);
});
test('multiple own photos complete one city; shared photos do not count',()=>{
 const index=indexCities({features:[city]});
 const photos=[{id:'one',lat:3,lng:3},{id:'two',lat:3.5,lng:3.5},{id:'friend',lat:3,lng:3,shared:true},{id:'outside',lat:9,lng:9}];
 const result=computeProgress(index,photos);assert.equal(result.completed.size,1);assert.equal(result.completed.get('01').photos.length,2);assert.equal(result.unmatched,1);
 assert.equal(computeProgress(index,photos.filter(p=>p.shared)).completed.size,0);
 assert.equal(computeProgress(index,[]).completed.size,0);
});
