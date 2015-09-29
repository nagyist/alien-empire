var socket_loadingDone = function() {

	var action = {
					player: clientTurn,
					actiontype: ACT_LOADED_ASSETS
				};

	socket.emit('do game action', clientGame.gameid, action, function(data){
		console.log('loaded assets: ', data);
	});
};

var socket_submitAction = function() {

	var action = pendingAction;

	socket.emit('do game action', clientGame.gameid, action, function(data) {
		console.log('server received game action:', data);
	});

};

var socket_submitTurnDone = function() {

	var action = { 
					player: clientTurn,
					actiontype: ACT_TURN_DONE
				 };

    socket.emit('do game action', clientGame.gameid, action, function(data){
        console.log('finished turn: ', data);
    });
};