const express = require("express");
const { createServer } = require("http"); // Change from node:http to http
const { join } = require("path"); // Change from node:path to path
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const { cpus } = require("os"); // Change from node:os to os
const cluster = require("cluster");
const { createAdapter, setupPrimary } = require("@socket.io/cluster-adapter");

// Database setup
let db;
async function initializeDB() {
    db = await open({
        filename: "./data.db",
        driver: sqlite3.Database,
    });
    await db.run(
        "CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT)"
    );
}
initializeDB();

// Cluster setup
if (cluster.isPrimary) {
    const numCPUs = cpus().length; // availableParallelism is not a function, use cpus().length instead
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork({
            PORT: 3000 + i,
        });
    }
    setupPrimary();
} else {
    main();
}

async function main() {
    const app = express();
    const server = createServer(app);
    const io = new Server(server, {
        connectionStateRecovery: true, // set to true for connection state recovery
        adapter: createAdapter(), // set up the adapter on each worker thread
    });

    app.get("/", (req, res) => {
        res.sendFile(join(__dirname, "index.html"));
    });

    io.on("connection", async(socket) => {
        socket.on("chat message", async(msg, clientOffset, callback) => {
            let result;
            try {
                // store the message in the database
                result = await db.run("INSERT INTO messages (content) VALUES (?)", msg);
            } catch (e) {
                if (e.errno === 19 /* SQLITE_CONSTRAINT */ ) {
                    // the message was already inserted, so we notify the client
                    callback();
                } else {
                    // handle other errors
                    console.error(e);
                    return;
                }
            }
            // include the offset with the message
            io.emit("chat message", msg, result.lastID);
            // acknowledge the event
            callback();
        });
        if (!socket.recovered) {
            // if the connection state recovery was not successful
            try {
                const rows = await db.all("SELECT id, content FROM messages");
                rows.forEach((row) => {
                    socket.emit("chat message", row.content, row.id);
                });
            } catch (e) {
                console.error(e);
            }
        }
    });

    const port = process.env.PORT || 3000; // Use PORT environment variable or default to 3000

    server.listen(port, () => {
        console.log(`server running at http://localhost:${port}`);
    });
}