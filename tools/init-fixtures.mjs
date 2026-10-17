import {initializeFixtureEnvironment} from '../dist/src/fixtures/setup.js';
import {createCore} from '../dist/src/application/core.js';
import {root} from './environment.mjs';
const fixture=await initializeFixtureEnvironment({workspaceRoot:root});const core=await createCore(fixture.metadataFile);await core.close();
console.log(JSON.stringify({metadataFile:fixture.metadataFile,targetDb:fixture.targetDb,targetRepo:fixture.targetRepo,environmentFile:fixture.root+'/product.env',sourceRef:fixture.sourceRef},null,2));
