let game_state = {
  WAITING: 0,
  PLAYING: 1,
};

let socket = io();

$(function () {
  // CHECK nickname OR SET NEW
  let nickname = localStorage.getItem("localnickname");
  if (nickname) {
    $(".nickname").html(`<div>${nickname}</div>`);
    socket.emit(
      "set new nickname",
      nickname,
      window.location.href.substring(window.location.href.lastIndexOf("/") + 1)
    );
  } else {
    $("#newName").click();
  }

  socket.emit("init"); // for sender-only update

  // CREATE NEW ROOM
  $("#new-room-create").click(() => {
    const roomName = $("#new-room-name").val();
    const hide = $("#hide").is(":checked");

    if (roomName !== "") {
      $("#chat-messages").empty(); //empty chat log
      showLoadingText();
      socket.emit("create game room", roomName, hide);
      $("#new-room-name").val("");
    } else {
      $("#noName").slideDown();
      setTimeout(() => {
        $("#noName").slideUp();
      }, 1500);
      return false;
    }
  });

  // JOIN ROOM
  $("#joinRoom").click(() => {
    const roomName = $("#joinRoomId").val();

    if (roomName !== "") {
      $("#chat-messages").empty(); //empty chat log
      showLoadingText();
      socket.emit("join game room", roomName);
      $("#joinRoomId").val("");
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
      socket.emit(
        "set new nickname",
        nickname,
        window.location.href.substring(
          window.location.href.lastIndexOf("/") + 1
        )
      );
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
  $("#form-chatting").click(() => {
    if (!/<\/?[a-z][\s\S]*>/i.test($("#message-input").val())) {
      socket.emit("chat message", $("#message-input").val());

      $("#message-input").val("");
      return false;
    } else {
      $("#message-input").val("Not here my friend");
    }
    return false;
  });

  // RECEIVE MSG FROM SERVER
  socket.on("chat message", (nickname, msg) => {
    $("#chat-messages").append($("<div>").text(`${nickname}: ${msg}`));
    $("#chat-messages").scrollTop($("#chat-messages").prop("scrollHeight"));
  });

  // button, must be checked on server side
  $("#ready-btn").on("click", () => {
    if (!$("#ready-btn").hasClass("disabled")) {
      socket.emit("ready");

      if($("#ready-btn").text()==="NOT READY") $("#ready-btn").text("READY");
      else $("#ready-btn").text("NOT READY");
    }
  });

  // pass turn, next order
  $("#play-btn").on("click", () => {
    if (!$("#play-btn").hasClass("disabled")) {
      $("#play-btn").addClass("disabled");
      socket.emit("play", selected_card);
    }
  });
});

// Redirect to Room URL
socket.on("connectUrl", (roomId) => {
  window.location.replace(`/room/${roomId}`);
});

//!	Personal Update

// UPDATE TITLE
socket.on("update sender", (user) => {
  $(".nickname").html(`<div>${user.nickname}</div>`);
  $("#room-title").text(`Room name: ${user.cur_room}`);
});

// ALERT FROM SERVER
socket.on("alert", (msg) => {
  $("#play-btn").removeClass("disabled");
  alert_big(msg);
});

// FADE IN ALERT
function alert_big(msg) {
  $("#error-msg-bg").fadeIn();
  $("#error-msg").text(msg);
  setTimeout(() => {
    $("#error-msg-bg").fadeOut();
  }, 3000);
}

//! Public(Shared) Update

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
    `<div class='p-4 w-100 mt-2 game-room rounded bg-secondary1'><strong>Room name:</strong> ${name} <strong>Players:</strong> ${length} / 8 <strong>- ${str}</strong></div>`
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
socket.on("refresh game room", (roomData) => {
  if (roomData.game.state == game_state.WAITING) {
    $("#ready-btn").removeClass("disabled");
  } else {
    // start
    $("#ready-btn").addClass("disabled");
  }

  // Set points
  showPoints(roomData);

  // List shared info
  reloadSlots(roomData);

  // Show cards
  reloadCards(socket.id, roomData);

  // show field
  reloadField(roomData);

  // enable first player
  setPlayable(roomData);
});

// CONNECT AND DISCCONECT CHAT MSG
socket.on("chat connection", (user) => {
  //connected to chat
  if (user.seat > -1)
    $("#chat-messages").append(
      $("<div>")
        .text(user.nickname + " connected")
        .addClass("font-weight-bold")
    );
  else
    $("#chat-messages").append(
      $("<div>")
        .text(user.nickname + " disconnected")
        .addClass("font-weight-bold")
    );
});

// CHAT ANNUNCE FUNCTION
socket.on("chat announce", (msg, color) => {
  let $new_msg = $("<div>").text(msg);
  $new_msg.css("color", color);
  $new_msg.addClass("font-weight-bold");
  $("#chat-messages").append($new_msg);
});

// CHECK TURN
function setPlayable(roomData) {
  let cur = -1;
  if (roomData.game.state == game_state.PLAYING)
    cur = roomData.game.cur_order_idx;

  for (let i = 0; i < 8; i++) {
    $("#player" + i).parent().removeClass("currentTurn");
  }

  $("#play-btn").addClass("disabled");

  for (const [sid, userData] of Object.entries(roomData.sockets)) {
    // IF IS USER ABILITATE TO PLAY CARD OR JUST SET TURN UI
    if (cur == userData.seat && sid == socket.id) {
      alert_big("Your turn!");
      $("#play-btn").removeClass("disabled");
      $("#player" + cur).parent().addClass("currentTurn");
    } else if (cur == userData.seat) {
      $("#player" + cur).parent().addClass("currentTurn");
    }
  }
}

// SHOW LOADING ANIMATION
function showLoadingText() {
  $("#title").text("Connecting...Please Wait");
  $("#room-list").empty();
}

function reloadSlots(roomData) {
  let cur = roomData.game.cur_order_idx;
  for (let i = 0; i < 8; i++) {
    $("#player" + i).empty();
  }

  for (const [sid, user] of Object.entries(roomData.sockets)) {
    $("#player" + user.seat).append($("<div><b>" + user.nickname + "</b></div>"));
    $("#player" + user.seat).append(
      $("<div>Cards: " + user.hand.length + "</div>")
    );

    if (roomData.game.state == game_state.WAITING) {
      if (user.ready) {
        $("#player" + user.seat).append($("<div>READY</div>"));
      } else {
        $("#player" + user.seat).append($("<div>NOT READY</div>"));
      }
    } else {
      if (user.ready) {
        $("#player" + user.seat).append($("<div>PLAYING</div>"));
        if (user.hand.length == 0)
          $("#player" + user.seat).append($("<div>WINNER</div>"));
      } // not ready, not in game
      else $("#player" + user.seat).append($("<div>SPECTATOR</div>"));
    }
  }
}

//! CARDS COLORS
var card_colors = [
  "#a500df",
  "#b6b6b6",
  "#d49602",
  "#fda4e3",
  "#f7f935",
  "#11a0bf",
  "#31bf11",
  "#00f6d7",
  "#f60000",
  "#1400ee",
  "#875432",
  "#545252",
  "#7d4e9f",
];
var selected_card = {};

function reloadCards(sid, roomData) {
  selected_card = {};
  $("#play-btn").text("PASS").addClass("bg-alert1").removeClass("btn-success");

  // card -1
  // its roomData not user
  let userData = roomData.sockets[sid];

  userData.hand.sort(function (a, b) {
    return a - b;
  });
  let actual_card_count = 1;

  $("#hand").empty();

  for (let i = 0; i < userData.hand.length; i++) {
    let $carddiv;
    // BACKGROUND COLOR = card_colors[userData.hand[i] - 1]
    if (userData.hand[i] != -1) {
      $carddiv = $(
        `<div class='cards text-center rounded' style='background-color:${
          card_colors[userData.hand[i] - 1]
        }'>${userData.hand[i]}</div>`
      );

      $carddiv.on("mouseenter", () => {
        if (!$carddiv.hasClass("selected")) $carddiv.addClass("cardSel");
      });
      $carddiv.on("mouseleave", () => {
        if (!$carddiv.hasClass("selected")) $carddiv.removeClass("cardSel");
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
        } else {
          //select
          selected_card[userData.hand[i]]++;
          $carddiv.addClass("selected");
        }

        // play/pass
        if (Object.keys(selected_card).length == 0) {
          $("#play-btn")
            .text("PASS")
            .addClass("bg-alert1")
            .removeClass("bg-success1");
        } else {
          $("#play-btn")
            .text("PLAY")
            .removeClass("bg-alert1")
            .addClass("bg-success1");
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
          `<div class='cards text-center' style='width:70px;margin:5px;height:100px;background-color:${
            card_colors[last_array[i] - 1]
          }'>${last_array[i]}</div>`
        );

        $("#field-section").append($carddiv);
      }
    }
}

// SHOW POINTS
function showPoints(roomData) {
  $('#statistics').empty() // Clear first
  for (const players in roomData.sockets) {
    let socket = roomData.sockets;

    if (socket[players].hasOwnProperty('points') && $(`#${players}`).length === 0) {
      let div = $(`<div id=${players} class="col w-100 pointsDiv">${socket[players].nickname}: ${socket[players].points}</div>`);
      let spaceDiv = $('<div class="w-100"></div>')
      $('#statistics').append(div, spaceDiv);
    } else if ($(`#${players}`).length === 0) {
      let div = $(`<div id=${players} class="col w-100 pointsDiv">${socket[players].nickname}: ${0}</div>`);
      let spaceDiv = $('<div class="w-100"></div>')
      $('#statistics').append(div, spaceDiv);
    };
  };
}

$(document).on("keydown", (e) => {
  if (e.keyCode === 13 && $("#id02").css("display") !== "none") {
    e.preventDefault();
    $("set-nickname-ok").click();
  } else if (e.keyCode === 13) e.preventDefault();
});
