import {fixtures} from '@api/fixtures';
import {
    accountAPI,
    trustchainsAPI,
    demoAPI,
    profileAPI,
    schemaAPI,
    tokenAPI,
    externalAPI,
    ipfsAPI
} from '@api/service';
import {Policy} from '@entity/policy';
import {Guardians} from '@helpers/guardians';
import {BlockTreeGenerator} from '@policy-engine/block-tree-generator';
import express from 'express';
import FastMQ from 'fastmq';
import {createServer} from 'http';
import {createConnection, getMongoRepository} from 'typeorm';
import WebSocket from 'ws';
import {authorizationHelper} from '@auth/authorizationHelper';
import {PolicyComponentsStuff} from '@policy-engine/policy-components-stuff';
import {importExportAPI} from '@policy-engine/import-export';
import { IPFS } from '@helpers/ipfs';

const PORT = process.env.PORT || 3002;

Promise.all([
    createConnection({
        type: 'mongodb',
        host: process.env.DB_HOST,
        database: process.env.DB_DATABASE,
        synchronize: true,
        logging: true,
        useUnifiedTopology: true,
        entities: [
            'dist/entity/*.js'
        ],
        cli: {
            entitiesDir: 'dist/entity'
        }
    }),
    FastMQ.Client.connect(process.env.SERVICE_CHANNEL, 7500, process.env.MQ_ADDRESS)
]).then(async ([db, channel]) => {
    // Fill test data
    await fixtures();

    // if (!(await getMongoRepository(Policy).find()).length) {
    //     await BlockTreeGenerator.GenerateMock();
    // }
    ///////////////////////////////////////

    // Init services
    const app = express();
    app.use(express.json());
    app.use(express.raw({
        inflate: true,
        limit: '4096kb',
        type: 'binary/octet-stream'
    }));

    new Guardians().setChannel(channel);
    new Guardians().registerMRVReceiver(async (data) => {
        console.log(data);
        await PolicyComponentsStuff.ReceiveExternalData(data);
    });

    new IPFS().setChannel(channel);

    const server = createServer(app);
    const policyGenerator = new BlockTreeGenerator();
    policyGenerator.registerWssServer(new WebSocket.Server({server}));
    for (let policy of await getMongoRepository(Policy).find(
        {where: {status: {$eq: 'PUBLISH'}}}
    )) {
        await policyGenerator.generate(policy.id.toString());
    }
    ////////////////////////////////////////

    // Config routes
    app.use('/policies', authorizationHelper, policyGenerator.getRouter());
    app.use('/policies', authorizationHelper, importExportAPI);
    app.use('/accounts/', accountAPI);
    app.use('/profile/', authorizationHelper, profileAPI);
    app.use('/schemas', authorizationHelper, schemaAPI);
    app.use('/tokens', authorizationHelper, tokenAPI);
    app.use('/trustchains/', authorizationHelper, trustchainsAPI);
    app.use('/external/', externalAPI);
    app.use('/demo/', demoAPI);
    app.use('/ipfs', authorizationHelper, ipfsAPI);
    /////////////////////////////////////////

    server.listen(PORT, () => {
        console.log('UI service started on', PORT);
    });
});
