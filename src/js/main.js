/////////////////////////////////////
// Entry
/////////////////////////////////////
var game_state = {
  WAITING: 0,
  PLAYING: 1,
};

var socket = io();

$(function () {
  // CHECK nickname OR SET NEW
  let nickname = localStorage.getItem("localnickname");

  if (nickname) {
    $(".nickname").html(`<div>${nickname}</div>`);
    socket.emit("set new nickname", nickname, window.location.href.substring(window.location.href.lastIndexOf('/') + 1));
  } else {
    $('#newName').click()
  }

  socket.emit("init"); // for sender-only update

  // CREATE NEW ROOM
  $("#new-room-create").click(() => {
    const roomName = $("#new-room-name").val();
    //empty chat log
    if (roomName !== "") {
      $("#chat-messages").empty();
      showLoadingText();
      socket.emit("create game room", roomName);
      $("#new-room-name").val("");
    } else {
      $("#noName").slideDown();
      setTimeout(() => {
        $("#noName").slideUp();
      }, 1500);
      return false;
    }
  });

  // UPDATE NICKNAME
  $("#set-nickname-ok").click(() => {
    let nickname = $("#set-nickname").val();

    if (nickname !== "") {
      localStorage.setItem("localnickname", nickname);
      socket.emit("set new nickname", nickname, window.location.href.substring(window.location.href.lastIndexOf('/') + 1));
      $(".nickname").html(`<div>${nickname}</div>`);
      $("#set-nickname").val("");
    } else {
      $("#noName").slideDown();
      setTimeout(() => {
        $("#noName").slideUp();
      }, 1500);
      return false;
    }
  });

  // CHAT HELPER
  $("#form-chatting").submit(() => {
    socket.emit("chat message", $("#message-input").val());

    $("#message-input").val("");
    return false;
  });

  // button, must be checked on server side
  $("#ready-btn").on("click", () => {
    if (!$("#ready-btn").hasClass("w3-disabled")) {
      socket.emit("ready");
    }
  });

  // pass turn, next order
  $("#play-btn").on("click", () => {
    if (!$("#play-btn").hasClass("w3-disabled")) {
      $("#play-btn").addClass("w3-disabled");
      socket.emit("play", selected_card);
    }
  });
});

// Save room name in local & Redirect to Room URL
socket.on("connectUrl", (roomId) => {
  window.location.replace(`/room/${roomId}`);
});

/////////////////////////////////////
//	Personal Update
/////////////////////////////////////
socket.on("update sender", (user) => {
  $(".nickname").html(`<div>${user.nickname}</div>`);
  $("#room-title").text(user.cur_room);
});

socket.on("alert", (msg) => {
  $("#play-btn").removeClass("w3-disabled");
  alert_big(msg);
});

function alert_big(msg) {
  $("#error-msg-bg").show();
  $("#error-msg").text(" " + msg + " ");
  setTimeout(() => {
    $("#error-msg-bg").hide();
  }, 3000);
}
/////////////////////////////////////
// Public(Shared) Update
/////////////////////////////////////

// UPDATE WAITING ROOMS LIST IN MAIN
socket.on("refresh waiting room", (user, rooms, user_count) => {
  let roomCount = 0;
  $("#room-list").empty(); // Clear before adding

  for (const [key, room] of Object.entries(rooms)) {
    appendGameRoom(key, Object.keys(room.sockets).length, room.game.state);
    roomCount++;
  }

  $("#title").html(
    `The Great Dalmuti <br><strong>${roomCount} rooms | ${user_count} users online</strong>`
  );
});

// SHOW GAMEROOM ON MAIN
function appendGameRoom(name, length, state) {
  let str = "";
  if (state == game_state.WAITING) str = "Waiting";
  else if (state == game_state.PLAYING) str = "Playing";

  let $newRoom = $(
    `<div class='p-4 w-100 mt-2 game-room'><strong>Room name:</strong> ${name} <strong>Players:</strong> ${length} / 8 <strong>- ${str}</strong></div>`
  );

  // join room
  $newRoom.on("click", () => {
    showLoadingText();
    socket.emit("join game room", name);
    $("#chat-messages").empty();
  });

  $("#room-list").append($newRoom);
}

//Enter Game Room
//Need Room specific data updated
socket.on("refresh game room", (roomData) => {
  if (roomData.game.state == game_state.WAITING) {
    $("#ready-btn").removeClass("w3-disabled");
  } else {
    // start
    $("#ready-btn").addClass("w3-disabled");
  }

  // debug
  // console.log(roomData)
  // list shared info
  reloadSlots(roomData);

  // show cards
  reloadCards(socket.id, roomData);

  // show field
  reloadField(roomData);

  // enable first player
  setPlayable(roomData);
});

socket.on("chat connection", (user) => {
  //connected to chat
  if (user.seat > -1)
    $("#chat-messages").append($("<li>").text(user.nickname + " connected"));
  else
    $("#chat-messages").append($("<li>").text(user.nickname + " disconnected"));
});

socket.on("chat announce", (msg, color) => {
  let $new_msg = $("<li>").text(msg);
  $new_msg.addClass("w3-text-" + color);
  $("#chat-messages").append($new_msg);
});

socket.on("chat message", (nickname, msg) => {
  $("#chat-messages").append($("<li>").text(nickname + ": " + msg));
  $("#chat-messages").scrollTop($("#chat-messages").prop("scrollHeight"));
});

function setPlayable(roomData) {
  // check who?
  let cur = -1;
  if (roomData.game.state == game_state.PLAYING)
    cur = roomData.game.cur_order_idx;

  for (let i = 0; i < 8; i++) $("#player" + i).removeClass("w3-bottombar");
  $("#player" + cur).addClass("w3-bottombar");

  $("#play-btn").addClass("w3-disabled");
  for (const [sid, userData] of Object.entries(roomData.sockets)) {
    // console.log(userData.seat+'=='+cur)
    if (cur == userData.seat && sid == socket.id) {
      alert_big("Your turn!");
      // current seat no. equals the user's and if this client is that user
      $("#play-btn").removeClass("w3-disabled");
    }
  }
}

function showLoadingText() {
  //waiting room
  $("#title").text("Connecting...Please Wait");
  $("#room-list").empty();
}

function reloadSlots(roomData) {
  for (let i = 0; i < 8; i++) {
    $("#player" + i).empty();
  }
  for (const [sid, user] of Object.entries(roomData.sockets)) {
    $("#player" + user.seat).append($("<p><b>" + user.nickname + "</b></p>"));
    $("#player" + user.seat).append(
      $("<p>Cards: " + user.hand.length + "</p>")
    );

    if (roomData.game.state == game_state.WAITING) {
      if (user.ready) $("#player" + user.seat).append($("<p>READY</p>"));
      else $("#player" + user.seat).append($("<p>NOT READY</p>"));
    } else {
      if (user.ready) {
        $("#player" + user.seat).append($("<p>PLAYING</p>"));
        if (user.hand.length == 0)
          $("#player" + user.seat).append($("<p>WINNER</p>"));
        else {
          // show pass or not
          if (roomData.game.cur_order[user.seat] == 0)
            $("#player" + user.seat).append($("<p>PASSED</p>"));
        }
      } // not ready, not in game
      else $("#player" + user.seat).append($("<p>SPECTATOR</p>"));
    }
  }
}

var card_colors = [
  "red",
  "purple",
  "indigo",
  "light-blue",
  "aqua",
  "green",
  "lime",
  "khaki",
  "amber",
  "deep-orange",
  "brown",
  "gray",
  "pink",
];
var selected_card = {};

function reloadCards(sid, roomData) {
  selected_card = {};
  $("#play-btn").text("PASS").addClass("w3-red").removeClass("w3-green");

  // card -1
  // its roomData not user
  let userData = roomData.sockets[sid];

  userData.hand.sort(function (a, b) {
    return a - b;
  });
  let actual_card_count = 1;

  $("#hand").empty();
  for (let i = 0; i < userData.hand.length; i++) {
    if (userData.hand[i] != -1) {
      let $carddiv = $(
        "<div class='cards w3-btn w3-border w3-border-black w3-display-container w3-" +
          card_colors[userData.hand[i] - 1] +
          "' style='width: 69px; height:10vh; position:absolute; left: calc(100% * " +
          actual_card_count +
          " / " +
          userData.hand.length +
          "); top: 3vh'><div class='w3-display-topleft'>" +
          userData.hand[i] +
          "</div><div class='w3-display-bottomright'>" +
          userData.hand[i] +
          "</div></div>"
      );

      $carddiv.on("mouseenter", () => {
        if (!$carddiv.hasClass("selected")) $carddiv.css("top", "1vh");
      });
      $carddiv.on("mouseleave", () => {
        if (!$carddiv.hasClass("selected")) $carddiv.css("top", "3vh");
      });

      $carddiv.on("click", () => {
        if (!selected_card[userData.hand[i]])
          selected_card[userData.hand[i]] = 0;

        if ($carddiv.hasClass("selected")) {
          // unselect
          selected_card[userData.hand[i]]--;
          if (selected_card[userData.hand[i]] == 0)
            delete selected_card[userData.hand[i]];

          $carddiv.removeClass("selected");
          $carddiv.css("top", "3vh");
        } else {
          //select
          selected_card[userData.hand[i]]++;
          $carddiv.addClass("selected");
          $carddiv.css("top", "1vh");
        }

        // play/pass
        if (Object.keys(selected_card).length == 0) {
          $("#play-btn")
            .text("PASS")
            .addClass("w3-red")
            .removeClass("w3-green");
        } else {
          $("#play-btn")
            .text("PLAY")
            .removeClass("w3-red")
            .addClass("w3-green");
        }
      });

      $("#hand").append($carddiv);
      actual_card_count++;
    }
  }
}

function reloadField(roomData) {
  $("#field-section").empty();

  if (roomData.game.state == game_state.PLAYING)
    if (roomData.game.last) {
      // to array
      let last_hand = roomData.game.last;
      delete last_hand.num;
      delete last_hand.count;
      let last_array = [];
      for (const [card, count] of Object.entries(last_hand)) {
        let m = count;
        while (m-- > 0) last_array.push(card);
      }

      //console.log(last_array)

      for (let i = 0; i < last_array.length; i++) {
        let $carddiv = $(
          "<div class='w3-border w3-border-black w3-display-container w3-" +
            card_colors[last_array[i] - 1] +
            "' style='width: 69px; height:10vh; position:absolute; left: calc(100% * " +
            i +
            " / " +
            last_array.length +
            "); top: 3vh'><div class='w3-display-topleft'>" +
            last_array[i] +
            "</div><div class='w3-display-bottomright'>" +
            last_array[i] +
            "</div></div>"
        );

        $("#field-section").append($carddiv);
      }
    }
}

$(document).on("keydown", (e) => {
  if (e.keyCode === 13 && $("#id02").css("display") !== "none") {
    e.preventDefault();
    $("set-nickname-ok").click();
  } else if (e.keyCode === 13) e.preventDefault();
});
