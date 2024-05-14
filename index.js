const express = require("express");
const http = require("http"); // Change from node:http to http
const path = require("path"); // Change from node:path to path
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const { cpus } = require("os");
const cluster = require("cluster");
const { createAdapter, setupPrimary } = require("@socket.io/cluster-adapter");

// Database setup
let db;
async function initializeDB() {
    db = await open({
        filename: path.join(__dirname, "data.db"), // Adjust path for deployment
        driver: sqlite3.Database,
    });
    await db.run(
        "CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT)"
    );
}
initializeDB();

// Cluster setup
if (cluster.isPrimary) {
    const numCPUs = cpus().length;
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork({
            PORT: process.env.PORT || 3000 + i, // Adjust port for deployment
        });
    }
    setupPrimary();
} else {
    main();
}

async function main() {
    const app = express();
    const server = http.createServer(app); // Create server using http
    const io = new Server(server, {
        connectionStateRecovery: true,
        adapter: createAdapter(),
    });

    app.get("/", (req, res) => {
        res.sendFile(path.join(__dirname, "index.html")); // Adjust path for deployment
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

    const port = process.env.PORT || 3000;

    server.listen(port, () => {
        console.log(`server running at port ${port}`);
    });
}