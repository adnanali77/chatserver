const express = require('express');
// const bodyParser = require('body-parser');
const cors = require('cors');
const tryUser = require("./models/UserSchemas")
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const mongoose = require("mongoose");
const { userInfo } = require("os");
const UAParser = require('ua-parser-js');
const si = require('systeminformation');
const dotenv = require('dotenv').config();

const app = express();

const http = require("http").createServer(app);
// app.use(bodyParser.json()); // Parse JSON bodies
// app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(cors({
  origin: '*',
}));
const uri = 'mongodb+srv://StampaChat:goUGOq2fUPoJUvpD@cluster0.n98lqzj.mongodb.net/';

async function connect(uri) {
  try {
    await mongoose.connect(uri);
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("error", error);
  }
}

connect(uri);

const io = require("socket.io")(http, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],

    allowedHeaders: ['Content-Type'],

    credentials: true,
  },
});

const conversationSchema = new mongoose.Schema({
  conversationId: {
    type: String,
    required: true,
    unique: true,
  },
  messages: [
    {
      content: {
        type: String,
        required: true,
      },
      from: {
        type: String,
        required: true,
      },
      to: {
        type: String,
        required: true,
      },
      timestamp: {
        type: Date,
        default: Date.now,
      },
    },
  ],
});
const Conversation = mongoose.model('Conversation', conversationSchema);

const UserSchema = mongoose.model("UserNew", {
  username: String,
  uuid: {
    type: String,
    default: uuidv4,
    unique: true
  },
  userID: String,
  ip: String,
  connectionTime: String,
  country_name: String,
  country_code2: String
});

const AdminSchema = mongoose.model("Admin", {
  username: String,
  uuid: {
    type: String,
    default: uuidv4,
    unique: true,
  },
  userID: [String], // Array of socket IDs
  ip: String,
  connectionTime: String,
});


app.post('/post', async (req, res) => {
  // console.log("Browser: " + req.headers["user-agent"]);
  try {
    const { username, role } = req.body;
    const user = new UserSchema({ username, role });
    await user.save();
    res.status(201).json(user);
  } catch (error) {
    console.error(error); // Log the actual error message
    res.status(500).json({ error: "Failed to create user" });
  }
});

io.use(async (socket, next) => {
  const username = socket.handshake.auth.fetched_userName;
  socket.username = username;
  next();
});
const users = new Map(); // Map to store connected users with username as key

io.on("connection", async (socket) => {
  const userAgent = socket.request.headers["user-agent"];
  const parser = new UAParser();
  const result = parser.setUA(userAgent).getResult();

  const browser = result.browser.name;
  const os = result.os.name;

  console.log("Browser:", browser);
  console.log("Operating System:", os);
  console.log("MachineInfo", userInfo().username)
  console.log("origin", socket.request.headers["origin"])

  const ip = socket.handshake.headers['x-real-ip'] || socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

  const clientip = ip.includes('::1') ? '127.0.0.1' : ip;
  if (clientip == '127.0.0.1') { formattedIP = '139.135.36.80' } else {
    formattedIP = clientip;
  }

  const response = await fetch(`https://api.iplocation.net/?ip=${formattedIP}`);

  if (!response.ok) {
    throw new Error('Network response was not ok');
  }
  const results = await response.json();

  const connectionTime = moment().format('h:mm:ss A');

  socket.on("disconnect", () => {
    for (const [username, user] of users) {
      if (user.userID === socket.id) {
        users.delete(username); // Remove the user from the Map
        break;
      }
    }
    io.emit("users", Array.from(users.values())); // Emit the updated users list
  });

  socket.on("private message", async ({ content, to }) => {

    const conversationId = `admin_${to}`;
    let conversation = await Conversation.findOne({ conversationId });

    if (conversation) {
      conversation.messages.push({ content, from: socket.id, to });
    } else {
      conversation = new Conversation({
        conversationId,
        messages: [{ content, from: socket.id, to }],
      });
    }

    // await conversation.save();
    socket.to(to).emit("private message", {
      content,
      from: socket.id,
    });
  });

  socket.on("private message admin", async ({ content, to, username }) => {

    const conversationId = `admin_${to}`;
    let conversation = await Conversation.findOne({ conversationId });

    if (conversation) {
      conversation.messages.push({ content, from: socket.id, to });
    } else {
      conversation = new Conversation({
        conversationId,
        messages: [{ content, from: socket.id, to }],
      });
    }

    // await conversation.save();
    const existingAdmin = await AdminSchema.findOne({ username: username });
    const socketIds = existingAdmin.userID

    socketIds.forEach((socketId) => {
      io.to(socketId).emit('private message', {
        content,
        from: socket.id,
      });
    });

  });

  socket.on("save message", async ({ content, to, conversationID }) => {
    const conversationId = `admin_${conversationID}`;
    let conversation = await Conversation.findOne({ conversationId });

    if (conversation) {
      conversation.messages.push({ content, from: socket.id, to });
    } else {
      conversation = new Conversation({
        conversationId,
        messages: [{ content, from: socket.id, to }],
      });
    }

    await conversation.save();
  });

  // Get username from handshake authentication
  const { fetched_userName } = socket.handshake.auth;
  socket.username = fetched_userName;

  // Remove the user if it exists with a different socket ID
  for (const [existingUsername, existingUser] of users) {
    if (existingUser.userID === socket.id && existingUsername !== socket.username) {
      users.delete(existingUsername);
      break;
    }
  }

  const newUser = {
    userID: socket.id,
    username: socket.username,
    key: socket.id,
    ip: formattedIP,
    country_name: results.country_name,
    country_code2: results.country_code2
  };
  users.set(socket.username, newUser); // Add or update the user in the Map

  socket.emit("users", Array.from(users.values()));
  socket.broadcast.emit("user connected", {
    userID: socket.id,
    username: socket.username,
    key: socket.id,
    self: false,
    ip: formattedIP,
    country_name: results.country_name,
    country_code2: results.country_code2
  });

  try {
    const existingUser = await UserSchema.findOne({ userID: socket.id });
    const existingAdmin = await AdminSchema.findOne({ username: "admin" });
    
    if (!existingUser) {
      if (!existingAdmin && socket.username === "admin") {
        const newUser = new AdminSchema({
          username: socket.username,
          uuid: uuidv4(),
          userID: [socket.id],
          ip: formattedIP,
          connectionTime: connectionTime
        });

        const savedUser = await newUser.save();
        // console.log('Admin saved:', savedUser);
      } else if (existingAdmin && socket.username === "admin") {
        existingAdmin.userID.push(socket.id);
        const savedAdmin = await existingAdmin.save();
        // console.log('Admin user updated:', savedAdmin);
      } else if (socket.username !== "admin") {
        const newUser = new UserSchema({
          username: socket.username,
          uuid: uuidv4(),
          userID: socket.id,
          ip: formattedIP,
          connectionTime: connectionTime
        });
        const savedUser = await newUser.save();
        // console.log('User saved:', savedUser);
      } else {
        console.log('None')
      }
    } else {
      console.log('User already exists:', existingUser);
    }

  } catch (error) {
    console.error('Error saving users:', error);
  }

});

app.get("/messages/:conversationId", async (req, res) => {

  try {
    const conversationId = req.params.conversationId;
    const message = await Conversation.findOne({ conversationId });
    res.json(message)
  }
  catch (error) {
    res.status(500).json(error)
  }
})

app.post("/users", async (req, res) => {
  try {
    const userInfo = req.body

    res.status(200).json(userInfo)
  }
  catch (error) {
    res.status(500).json(error)
  }
})

app.get("/", async (req, res) => {
  try {
    res.send("Hi from server");
  }
  catch (error) {
    res.status(500).json(error)
  }
})

// const port = process.env.PORT;
const port = 4200;
http.listen(port, () => {
  console.log("Listening on port 4200",port);
});
