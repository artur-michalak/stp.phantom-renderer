var cluster = require('cluster'),
    Server = require('./server'),
    logger = require('./logger').logger,
    config = require('./config'),
    argv = require('minimist')(process.argv.slice(2)),
    httpProxy = require('http-proxy'),
    getPort = require('get-port'),
    http = require('http'),
    _ = require('lodash'),
    i, server, proxy, port, url, workerServers = [];

if(argv.port) {
    port = argv.port;
}
else {
    logger.error('Please provide port with "--port" option');
    process.exit();
}

if(argv.port) {
    url = argv.url;
}
else {
    logger.error('Please provide url with "--url" option');
    process.exit();
}

function spawnChild() {
    getPort(function (err, port) {
        var worker = cluster.fork();
        workerServers.push({id: worker.id, port: port});

        worker.send({port: port});
    });
}

if(cluster.isMaster) {
    for (i = 0; i < (config.workers || 2); i += 1) {
        logger.info('Starting worker thread #' + (i + 1));
        spawnChild();
    }

    cluster.on('exit', function (worker) {
        logger.info('Worker ' + worker.id + ' died.');

        _.remove(workerServers, function(element){
            return element.id === worker.id;
        });

        // spin up another to replace it
        logger.info('Restarting worker thread...');
        spawnChild();
    });

    proxy = httpProxy.createProxyServer({});
    server = http.createServer(function(req, res) {
        var workerServer = workerServers.shift();
        workerServers.push(workerServer);
        proxy.web(req, res, {target: 'http://127.0.0.1:' + workerServer.port});
    });

    proxy.on('error', function (err, req, res) {
        res.writeHead(500, {
            'Content-Type': 'text/plain'
        });
        res.end('Something went wrong');
    });

    logger.info('Master listening on port ' + argv.port);
    server.listen(argv.port);

} else {
    logger.info('Worker ' + cluster.worker.id + ' started');
    logger.setProcessInfo('Worker id #' + cluster.worker.id);

    process.on('message', function(msg) {
        var port = msg.port;
        server = new Server({
            logger: logger,
            url: url,
            port: port,
            workerId: cluster.worker.id,
            blacklistedDomains: config.blacklistedDomains,
            pageRequestsBeforeRespawn: config.pageRequestsBeforeRespawn,
            page404meta: config.page404meta
        });
        server.start();
    });

    process.on('uncaughtException', function( err ) {
        console.error('Process uncaughtException');
        console.error(err.stack);
    });

    process.on("exit", function() {
       if(server && server.phantom) {
           logger.info('Process exit - dispose phantom');
           server.phantom.dispose();
       }
    });
}