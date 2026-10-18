import { createBdd } from 'playwright-bdd';
const { Given }=createBdd();
Given('known fixture step',async()=>{throw Error('Negative generation fixture must never execute');});
