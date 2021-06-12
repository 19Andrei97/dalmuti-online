var express = require("express");
var app = express();
var http = require("http").Server(app);
var io = require("socket.io")(http);
var cors = require("cors");
let {
  Player,
  game_state,
  Game,
  user_count,
  connectNumber,
} = require("./server/config");
let roomsInfo = { roomNumber: 0, rooms: {} };

var port = process.env.PORT || 8080;
app.use(express.static(__dirname + "/src"));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/src/index.html");
});

app.get("/help", (req, res) => {
  res.sendFile(__dirname + "/src/help.html");
});

app.get(`/room/:roomName`, cors(), (req, res, next) => {
  if (roomsInfo.rooms[req.params.roomName])
    res.sendFile(__dirname + "/src/room.html");
  else next();
});

// catch 404 and forward to error handler
app.use((req, res, next) => {
  var err = new Error("Not Found");
  err.status = 404;
  return next(err);
});
// development error handler
if (app.get("env") === "development") {
  app.use((err, req, res, next) => {
    res.status(err.status || 500);
    console.log({
      message: err.message,
      // error: err,
    });
    return res.sendFile(__dirname + "/src/fourOfour.html");
  });
}

io.on("connection", (socket) => {
  user_count++;
  socket.userData = new Player("Guest" + connectNumber, "main room");
  connectNumber++;

  // give update to a client only
  socket.join("waiting room");

  io.to("waiting room").emit(
    "refresh waiting room",
    socket.userData,
    roomsInfo.rooms,
    user_count
  );

  console.log(
    "\x1b[36mNEW:\x1b[0m",
    socket.userData.nickname + " joined main room"
  );

  //! PLAYER SETTINGS

  socket.on("init", () => {
    socket.emit("update sender", socket.userData);
  });

  // Set nickname and check adding to room
  socket.on("set new nickname", (n_nickname, roomId) => {
    console.log(
      "\x1b[32mUPDATE:\x1b[0m",
      "Nickname change from " + socket.userData.nickname + " to " + n_nickname
    );
    socket.userData.nickname = n_nickname;

    // Check if player should be assosiacted to a room
    if (roomsInfo.rooms.hasOwnProperty(roomId)) {
      joinRoom(socket, roomsInfo.rooms, roomId);
    }

    socket.emit("update sender", socket.userData);
  });

  //! ROOMS FUNCTIONS

  // CREATE ROOM
  socket.on("create game room", (room_name) => {
    roomsInfo.roomNumber++;
    let idRoom = `${roomsInfo.roomNumber}-${room_name}`;
    joinRoom(socket, roomsInfo.rooms, idRoom); // Use helper to create and join room
    socket.emit("connectUrl", idRoom);
  });

  // JOIN ROOM
  socket.on("join game room", (room_name) => {
    joinRoom(socket, roomsInfo.rooms, room_name);
    socket.emit("connectUrl", room_name);
  });

  socket.on("chat message", (msg) => {
    io.to(socket.userData.cur_room).emit(
      "chat message",
      socket.userData.nickname,
      msg
    );
  });

  socket.on("ready", () => {
    let room_name = socket.userData.cur_room;

    // can only ready during waiting
    if (
      roomsInfo.rooms[room_name].game.state == game_state.WAITING &&
      !socket.userData.ready
    ) {
      socket.userData.ready = true;
      roomsInfo.rooms[room_name].game.readyCount++;
      syncUserToRoom(socket, roomsInfo.rooms);

      // send out updated data
      io.to(room_name).emit("refresh game room", roomsInfo.rooms[room_name]);

      // check game state, is it WAITING? more than 2 ready?

      // Shared data, so use roomData not userData
      if (
        roomsInfo.rooms[room_name].length >= 2 &&
        roomsInfo.rooms[room_name].game.readyCount ==
          roomsInfo.rooms[room_name].length
      ) {
        //start game
        console.log("\x1b[36mNEW:\x1b[0m", room_name + ": game started");
        io.to(room_name).emit("chat announce", "The game has started.", "blue");
        // set order, shuffle, etc.
        roomsInfo.rooms[room_name].game.start(roomsInfo.rooms[room_name]);

        // distribute
        let handlim = Math.floor(80 / roomsInfo.rooms[room_name].length);
        let cnt = 0;
        for (const [sid, user] of Object.entries(
          roomsInfo.rooms[room_name].sockets
        )) {
          for (let i = cnt * handlim; i < handlim * cnt + handlim; i++) {
            user.hand.push(roomsInfo.rooms[room_name].game.deck[i]); // userData and room user Data not in sync
          }
          cnt++;
        }

        io.to("waiting room").emit(
          "refresh waiting room",
          socket.userData,
          roomsInfo.rooms,
          user_count
        ); // notify start
        io.to(room_name).emit("refresh game room", roomsInfo.rooms[room_name]);
      }
    }
  });

  socket.on("play", (selected_card) => {
    let room_name = socket.userData.cur_room;

    // but first of all, is it playing?
    if (
      socket.adapter.roomsInfo.rooms[room_name].game.state != game_state.PLAYING
    ) {
      socket.emit("alert", "This should not happen.");
      return;
    }

    if (checkOrder(socket, socket.adapter.roomsInfo.rooms[room_name])) {
      // delete 0 cards, this won't happen unless someone messed with client code
      for (const [card, val] of Object.entries(selected_card)) {
        if (val == 0) delete selected_card[card];
      }
      console.log(selected_card);

      // check PASS
      if (Object.keys(selected_card).length == 0) {
        // 0 card submitted
        let tmp_idx = roomsInfo.rooms[room_name].game.cur_order_idx; //현재 순서
        roomsInfo.rooms[room_name].game.cur_order[tmp_idx] = 0; // pass

        // if this is last pass, erase last hand give prior to last player who played
        // also renew cur_order for next round
        // and update last hand. Last hand will be used to display cards on field
        socket.adapter.rooms[room_name].game.nextPlayer(selected_card);

        io.to(room_name).emit(
          "refresh game room",
          socket.adapter.rooms[room_name]
        );
      } else if (
        checkValidity(socket, socket.adapter.rooms[room_name], selected_card)
      ) {
        if (checkRule(socket.adapter.rooms[room_name], selected_card)) {
          // Everything seems fine.

          // update hand
          updateHand(socket, socket.adapter.rooms[room_name], selected_card);

          //Winning condition
          if (
            socket.adapter.rooms[room_name].sockets[socket.id].hand.length == 0
          ) {
            // win due to empty hand
            socket.adapter.rooms[room_name].game.updateOrder(
              socket.userData.seat,
              room_name
            );
            io.to(room_name).emit(
              "chat announce",
              socket.userData.nickname + " has won!!!",
              "green"
            );

            if (socket.adapter.rooms[room_name].game.isOneLeft()) {
              io.to(room_name).emit(
                "chat announce",
                "The game has ended due to only one player remaining.",
                "red"
              );
              //end game
              socket.adapter.rooms[room_name].game.end();
              for (const [sid, userData] of Object.entries(
                socket.adapter.rooms[room_name].sockets
              )) {
                userData.reset();
              }
            }
          }

          socket.adapter.rooms[room_name].game.nextPlayer(selected_card);
          // refresh
          io.to(room_name).emit(
            "refresh game room",
            socket.adapter.rooms[room_name]
          );
        } else {
          // nope
          socket.emit("alert", "Please choose the right cards.");
        }
      } else {
        socket.emit("alert", "This should not happen.");
      }
    } // check order
    else {
      socket.emit("alert", "Please wait for your turn.");
    }
  });

  socket.on("disconnect", () => {
    user_count--;
    console.log(
      "\x1b[31mDISCONNECTED:\x1b[0m",
      socket.userData.nickname + " disconnected from server"
    );

    updateRoomDisconnect(socket, socket.userData.cur_room, roomsInfo.rooms);

    io.to("waiting room").emit(
      "refresh waiting room",
      socket.userData,
      roomsInfo.rooms,
      user_count
    );
    //We want to avoid user from disconnecting during game
    //so if this happens its 'all disconnect'. no leaving during the game
    // redistribute
  });
  //Game, broadcast only to same room
});

//! HELPER

// ADD USER TO ROOM IN SERVER
function syncUserToRoom(socket, roomObj) {
  // Check if user isn't in waiting rooom and already in the room
  if (
    socket.userData.cur_room != "waiting room" &&
    roomObj[socket.userData.cur_room]
  ) {
    if (!roomObj[socket.userData.cur_room].sockets) {
      roomObj[socket.userData.cur_room].sockets = {};
      roomObj[socket.userData.cur_room].sockets[socket.id] = socket.userData;
    } else {
      roomObj[socket.userData.cur_room].sockets[socket.id] = socket.userData;
    }
  }
  // Add user to room in server
}

// DISCONNECT
function updateRoomDisconnect(socket, room_name, roomsObj) {
  socket.leave(room_name);
  socket.join("waiting room");

  // update room
  if (roomsObj[room_name]) {
    roomsObj[room_name].seats[socket.userData.seat] = false;
    delete roomsObj[room_name].sockets[socket.id]; // Delete player from room

    // undo ready if left with 'ready' before the game start
    if (socket.userData.ready) roomsObj[room_name].game.readyCount--;

    // user left during the game
    // omit from order list
    if (roomsObj[room_name].game.state == game_state.PLAYING) {
      roomsObj[room_name].game.updateOrder(socket.userData.seat, room_name);

      if (roomsObj[room_name].game.isOneLeft()) {
        io.to(room_name).emit(
          "chat announce",
          "The game has ended due to only one player remaining.",
          "red"
        );
        //end game
        roomsObj[room_name].game.end();
        for (const [sid, userData] of Object.entries(
          roomsObj[room_name].sockets
        )) {
          userData.reset();
        }

        delete roomsObj[room_name];
      }

      // pass or evaluate or refresh during game...? pass turn?
      if (roomsObj[room_name].game.cur_order_idx == socket.userData.seat) {
        // pass turn
        roomsObj[room_name].game.nextPlayer({});
      }
      // 아무튼 그래야 자기 턴인 애가 나갔을 때, 아닌애가 나갔을 때
      io.to(room_name).emit("refresh game room", roomsObj[room_name]);

    }

    // Loop delete empty room exepct this
    for (const key in roomsObj) {
      if (Object.keys(roomsObj[key].sockets).length <= 0 && key !== room_name) {
        delete roomsObj[key];
      }
    }
  }

  // update/reset user
  socket.userData.reset();
  socket.userData.leaveRoom();

  io.to(room_name).emit("refresh game room", roomsObj[room_name]);
  io.to(room_name).emit("chat connection", socket.userData);
}

// JOIN THE ROOM
function joinRoom(socket, roomObj, room_name) {
  // seat vacancy check
  socket.leave("waiting room");
  socket.join(room_name);
  console.log(socket.userData.nickname + " joined " + room_name);

  // integrity update
  if (!roomObj[room_name] || !roomObj[room_name].seats) {
    roomObj[room_name] = {};
    roomObj[room_name].seats = new Array(8).fill(false);
  }

  // Loop for free seats
  for (let i = 0; i < 8; i++) {
    if (!roomObj[room_name].seats[i]) {
      // is vacant
      roomObj[room_name].seats[i] = true;
      socket.userData.seat = i;
      break;
    }
  }

  // Check if room is full
  if (socket.userData.seat == -1) {
    //TODO full emit
    console.log("room full");
    socket.leave(room_name);
    socket.join("waiting room");
    socket.emit(
      "refresh waiting room",
      socket.userData,
      roomsInfo.rooms,
      user_count
    );
    socket.emit("alert", "Room is full");
    return false;
  }

  // if there is no game object, give one
  if (!roomObj[room_name].game) roomObj[room_name].game = new Game();

  //update user
  socket.userData.cur_room = room_name;

  //update room data
  syncUserToRoom(socket, roomObj);

  //refresh list
  io.to("waiting room").emit(
    "refresh waiting room",
    socket.userData,
    roomsInfo.rooms,
    user_count
  );

  io.to(room_name).emit("refresh game room", roomsInfo.rooms[room_name]); // send info about room
  io.to(room_name).emit("chat connection", socket.userData);

  socket.emit("update sender", socket.userData);
}

function checkOrder(socket, roomData) {
  if (socket.userData.seat != roomData.sockets[socket.id].seat)
    // correctly in the room?
    return false; // illegal behavior detected

  if (roomData.game.cur_order_idx != socket.userData.seat)
    // check turn
    return false; // illegal behavior detected

  return true;
}

// check if selected cards are actually in hand
function checkValidity(socket, roomData, selected_card) {
  let sid = socket.id;
  let hand_map = {};
  for (let i = 0; i < roomData.sockets[sid].hand.length; i++) {
    let card = roomData.sockets[sid].hand[i];
    if (!hand_map[card]) hand_map[card] = 0;
    hand_map[card]++;
  }

  for (const [card, count] of Object.entries(selected_card)) {
    if (!hand_map[card])
      // selected card is not available in hand: illegal
      return false;
    else {
      //if there is, count should be equal to or less
      if (count > hand_map[card]) return false; // more is selected than what a user has: illega
    }
  }

  return true;
}

function checkRule(roomData, selected_card) {
  let count = 0;
  for (const [card, val] of Object.entries(selected_card)) {
    count += val;
  }

  // no more than two types of cards
  if (Object.keys(selected_card).length > 2) return false;
  // if there are, illegal
  else if (Object.keys(selected_card).length == 2 && !selected_card[13])
    // if there are two types of cards, one of them must be 13
    return false; //else illegal

  // last is merged as {num: no, count: count}
  if (roomData.game.last) {
    // card count should be the same
    if (roomData.game.last.count != count) return false; // else illegal

    //single card type which is normal, then 13 has no power
    if (Object.keys(selected_card).length == 1) {
      for (const [card, val] of Object.entries(selected_card)) {
        if (roomData.game.last.num - card <= 0) {
          // can't throw 13 alone
          console.log(roomData.game.last.num + " <= " + card);
          return false; // if any of card no. is equal/greater than the last one, no go
        }
      }
    } else {
      // more than 1 card type
      console.log("13 included");
      // case with with 13
      // except 13, the card no. must be smaller
      for (const [card, val] of Object.entries(selected_card)) {
        if (card != 13 && roomData.game.last.num - card <= 0) {
          return false; // if any of card no. is equal/greater than the last one, no go
        }
      }
    }

    // if everything checks, then good to go
    return true;
  } else {
    // there is no previous play, or deleted due to winning a round
    return true;
  }
}

function updateHand(socket, roomData, selected_card) {
  let sid = socket.id;
  let room_name = socket.userData.cur_room;
  let hand_map = {};
  for (let i = 0; i < roomData.sockets[sid].hand.length; i++) {
    let card = roomData.sockets[sid].hand[i];
    if (!hand_map[card]) hand_map[card] = 0;
    hand_map[card]++;
  }

  for (const [card, count] of Object.entries(selected_card)) {
    hand_map[card] -= count;
  }
  // map to list
  let new_hand = [];
  for (const [card, count] of Object.entries(hand_map)) {
    let m = count;
    while (m-- > 0) new_hand.push(card);
  }
  roomData.sockets[sid].hand = new_hand;

  // if your hand is empty? you win
}

http.listen(port, () => {
  console.log("Listening: " + port);
});
