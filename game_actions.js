/**
 * game_actions contains all functions for handling player actions during a game.
 * contains functions to change game variables and check legality of moves
 */

var cons = require('./server_constants');
var helpers = require('./game_helpers');

(function() {

	/**
	 * Assumes the action type of the player is the ending of a turn
	 * Returns the appropriate event and game update
	 * Returns a value indicating the sockets to update, the socket
	 * event to call, and a game object update.
	 *
	 * @action {action} action object sent from client
	 * @game game object pulled from gameInfo of client's game
	 * @return [sockets to update, event type, game object]
	 */
	module.exports.resolveTurnDone = function( action, game ) {
		// This is stand in logic. End game condition should be checked 
		// during the upkeep phase
		if ( isEndCondition( game ) ){
			return {
					to: cons.EVENT_ALL,
					evnt: 'game end',
					content: {}
				};
		}
		else if ( game.turn != action.player ){
			return {
					to: cons.EVENT_ONE,
					evnt: 'illegal action',
					content: "it is not your turn"
				};
		}
		else { // increment round round
			updateTurn( game );
			return {
					to: cons.EVENT_ALL,
					evnt: 'game event',
					content: {
						game: game
					}
				};
		}
	};

	/**
	 * Send players a turn update to give them the current status of the board
	 * when they've loaded their art assets. 
	 * (reasoning: it is possible some clients will load slowly and it should be 
	 * legal for other players to begin placing mines during this time)
	 */
	module.exports.resolveLoadingDone = function( action, game ) {
		return {
				to: cons.EVENT_ONE,
				evnt: 'loading done',
				content: {
					game: game
				}
			};
	};

	/** 
	 * Resolves a placement action. Calls functions to update the game state 
	 * and returns true. Returns false if illegal
	 */
	module.exports.resolveGameAction = function( action, game ) {

		// calls applyAction to apply user action to game
		// gets a return value that includes isIllegal status,
		// 
		var applyResult = applyAction( action, game );

		if( applyResult.isIllegal ) {
			return {
					to: cons.EVENT_ONE,
					evnt: 'illegal action',
					content: applyResult.response
				};
		} 
		else {
			return {
					to: cons.EVENT_ALL,
					evnt: 'game event',
					content: {
							game: game,
							action: action,
							response: applyResult.response
						}
					};
		}
	};

}());

var applyAction = function( action, game ){
	switch ( action.actiontype ) {
		case cons.ACT_PLACE:
			return applyPlaceAction( action, game );
		case cons.ACT_BUILD:
			return applyBuildAction( action, game );
		case cons.ACT_RECRUIT:
			return applyRecruitAction( action, game );
		case cons.ACT_COLLECT_RESOURCES:
			return applyCollectResourcesAction( action, game );
		case cons.ACT_PAY_UPKEEP:
			return applyPayUpkeep( action, game );
		default:
			return { 
					isIllegal: true,
					response: "That is an unknown action"			
				};
	}
};

/**
 * Determines if placement is legal. If so, modifies the game and 
 * returns true. Returns false if illegal.
 */
var applyPlaceAction = function( action, game ){ 
	var player = action.player;
	var objecttype = action.objecttype;
	var planetid = action.planetid;
	var index = action.resourceid;

	if(index == cons.RES_NONE) {
		return { 
				isIllegal: true,
				response: "You must place this on a resource"
			};
	}
	else if( game.board.planets[planetid].resources[index].structure ) {
		return { 
				isIllegal: true,
				response: "You cannot place this on another structure"
			};
	}
	else {
		game.board.planets[planetid].resources[index].structure = {
												player: player,
												kind: objecttype
											};
		game.structures[action.player][action.objecttype] -= 1;

		updateSettledBy( player, 
						 planetid, 
						 game );

		updateBuildableBy( player,
						   planetid,
						   game );

		updateTurn( game ); // placing should increment the turn
		
		calcResourcesToCollect( game, player );
		return { isIllegal: false };
	}
};

var applyBuildAction = function( action, game ) {
	var planetid = action.planetid;
	var objecttype = action.objecttype;
	var index = action.resourceid;
	var player = action.player;
	var planet = game.board.planets[planetid];

	// check to make sure game is on the build phase
	if ( game.phase != cons.PHS_BUILD ){
		return { isIllegal: true,
				 response: "This action must be done during the build phase" };
	}

	if ( game.turn != player ) {
		return { isIllegal: true,
				 response: "This action must be done during your turn" };
	}

	// check to make sure player has an available structure
	if ( game.structures[ player ][ objecttype ] <= 0 ){

		return { isIllegal: true,
				 response: "You cannot build another " 
							+ cons.OBJ_ENGLISH[objecttype]
				};

	} 
	else if ( !hasEnoughToBuild( player, objecttype, game ) ) {
	
		return { isIllegal: true,
				 response: "You do not have enough resources to build a new " 
							+ cons.OBJ_ENGLISH[objecttype]
				};
	}

	// Currently we're doing all the build logic in this switch statement.
	// We should break this into functions.
	switch( objecttype ){

		case cons.OBJ_BASE:
			if ( !planet.base ) {

				// TODO: This block of ~3 lines is very similar for all
				// Structures. We should generalize this.
				game.board.planets[planetid].base = {
													player: action.player,
													used: false
												};
				payToBuild( player, objecttype, game);
				game.structures[player][cons.OBJ_BASE] -= 1;

				updateSettledBy( player, 
								 planetid, 
								 game );

				updateBuildableBy( player,
								   planetid,
								   game );

				addPointsForStructure( player, 
									   objecttype, 
									   planetid, 
									   game);
			}
			else {
				return { 
					isIllegal: true,
					response: "Only one base can be built on a planet"
				};
			}
			break;

		case cons.OBJ_FLEET:

			// Go through all fleets, set planetid of first fleet 
			// with planetid set to null
			// If none found, return illegal action message
			for ( var i = 0; i < cons.NUM_FLEETS; i++ ) {

				var id = String(player) + String(i);
				var fleet = game.board.fleets[ id ];
				var base = game.board.planets[planetid].base;

				if ( base && base.player == player ) {

					// update fleet and planet.fleets
					if ( fleet.planetid == undefined ) {

						fleet.planetid = planetid;
						fleet.used = false;
						planet.fleets.push( id );

						payToBuild( player, objecttype, game);
						game.structures[player][cons.OBJ_FLEET] -= 1;

						addPointsForStructure( player, 
											   objecttype, 
											   planetid, 
											   game);
						
						break;
					}
				}
				else {
						
					return { 
						isIllegal: true,
						response: "You must build fleets where you have a base"
					};
				}
			}
			break;

		case cons.OBJ_FACTORY:
		case cons.OBJ_EMBASSY:
			game.board.planets[planetid].resources[index].structure = {
												player: player,
												kind: objecttype
											};
			payToBuild( player, objecttype, game);

			game.structures[player][objecttype] -= 1;
			game.structures[player][cons.OBJ_MINE] += 1;

			updateSettledBy( player, 
						   planetid, 
						   game );

			updateBuildableBy( player,
							   planetid,
							   game );

			addPointsForStructure( player, 
								   objecttype, 
								   planetid, 
								   game );
			break;

		case cons.OBJ_MINE:
			game.board.planets[planetid].resources[index].structure = {
												player: player,
												kind: objecttype
											};
			payToBuild( player, objecttype, game);
			game.structures[player][cons.OBJ_MINE] -= 1;

			updateSettledBy( player, 
							 planetid, 
							 game );

			updateBuildableBy( player,
							   planetid,
							   game );

			addPointsForStructure( player, objecttype, planetid, game);
			break;

		default:
			return { isIllegal: true,
					 response: "Unknown building type"
					};
	}

	calcResourcesToCollect( game, player);
	return { isIllegal: false };
};

var applyRecruitAction = function( action, game ) {
	var agenttype = action.agenttype;
	var planetid = action.planetid;
	var player = action.player;

	var id = String(player) + String(agenttype);
	var agent = game.board.agents[ id ];
	var objecttype = cons.AGT_OBJTYPE[ agenttype ];

	// check to make sure game is on the build phase
	if ( game.phase != cons.PHS_BUILD ){
		return { isIllegal: true,
				 response: "You must recruit new agents during the build phase" };
	}

	if ( game.turn != player ) {
		return { isIllegal: true,
				 response: "You must recruit agents during your turn" };
	}

	if ( agent.status == cons.AGT_STATUS_DEAD ) {
		return { isIllegal: true,
				 response: "Your " + cons.AGT_ENGLISH[agenttype] 
				 			+ " cannot return during this game."
			};
	}

	if ( agent.status == cons.AGT_STATUS_ON ) {
		return { isIllegal: true,
				 response: "Your " + cons.AGT_ENGLISH[agenttype] 
				 			+ " is already on the board."
			};
	}

	if ( !helpers.playerHasStruct( player, planetid, objecttype, game)){
		return { isIllegal: true,
				 response: "You must recruit a new " + cons.AGT_ENGLISH[agenttype] 
				 			+ " at your " + cons.OBJ_ENGLISH[objecttype]
			};
	}

	agent.planetid = planetid;
	agent.used = false;
	agent.status = cons.AGT_STATUS_ON;
	game.board.planets[planetid].agents.push( id );

	return { isIllegal: false};
};

var applyCollectResourcesAction = function( action, game ){
	var player = action.player;
	
	if ( game.phase != cons.PHS_RESOURCE ) {
		return { isIllegal: true,
				 response: "The resource phase is complete"
			};
	}

	if ( game.phaseDone[player] ) {
		return { isIllegal: true,
				 response: "You have already collected resources"
			};
	}

	calcResourcesToCollect( game, player );

	var collect = game.resourceCollect[player];

	// Check here if the user has too many resources and reject until
	// they've 4:1'd their extras before allowing them to collect new resources
	for (var i = 0; i <= cons.RES_FOOD; i++){
		if (game.resources[player][i] + collect[i] > 10){
			return { isIllegal: true,
				 response: "You must trade or 4 to 1 before collecting more"
			};
		}
	}

	collectPlayerResources(action, game);

	game.phaseDone[player] = true;
	updatePhase( game );

	return { isIllegal: false};
};

var applyPayUpkeep = function( action, game ){

	var player = action.player;

	if ( game.phase != cons.PHS_UPKEEP ){
		return { isIllegal: true,
				 response: "The upkeep phase is complete"
			};
	}

	if ( game.phaseDone[player] ) {
		return { isIllegal: true,
				 response: "You have already paid upkeep"
			};
	}

	calcResourceUpkeep( game, player );

	// Check here if the user has too few resources and return illegal message if so
	// They will need to remove some stuff and re-submit an upkeep action

	payPlayerUpkeep(action, game);

	game.phaseDone[player] = true;
	updatePhase( game );

	return { isIllegal: false };
};

var collectPlayerResources = function( action, game){

	var toCollect = game.resourceCollect[action.player];

	for ( var i = 0; i < toCollect.length; i++){
		game.resources[action.player][i] += toCollect[i];
	}
};

var payPlayerUpkeep = function(action, game){

	var toPay = game.resourceUpkeep[action.player];

	for ( var i = 0; i < toPay.length; i++) {
		game.resources[action.player][i] -= toPay[i];
	}
};

// Updates planet.settledBy[player] to true or false 
// 
// Currently assumes we added a bulding. We will need to add logic
// To remove from planet.settledBy if the last structure a player
// has on planetid is removed
var updateSettledBy = function( player, planetid, game ) {
	game.board.planets[planetid].settledBy[player] = true;
};

// Updates planet.buildableBy[player] to true or false for this planet
// and all planets adjacent to it
//
// Currently assumes we added a bulding. We will need to add logic
// To remove from planet.settledBy if the last structure a player
// has on planetid is removed
var updateBuildableBy = function( player, planetid, game ) {

	var planets = game.board.planets;

	planets[planetid].buildableBy[player] = true;

	// for each planet id bordering this planet (including itself)
	for ( var pid in planets[planetid].borders ){
		// if border is open with this planet (not unexplored or blocked)
		if ( planets[planetid].borders[pid] == cons.BRD_OPEN ){
			// set buildableBy to true for this player
			planets[pid].buildableBy[player] = true;
		}
	}
};

/**
 * This calculates and updates the resourceCollect array for a single
 * player. It should be run at various times during each round, particularly
 * when a building is created or removed, or a mission is completed.
 *
 * TODO: this is technically pretty inefficent. It would be better
 * to only update when a building is added, upgraded, destroyed, or a 
 * resource num is changed, but it shouldn't be a big deal for the numbers
 * we're dealing with
 */
var calcResourcesToCollect = function( game, player ) {
	
	var resourceCollect = [0, 0, 0, 0];
	var planets = game.board.planets;
	
	for ( var i = 0; i < planets.length; i++ ) {
		
		if (planets[i].explored) {

			for ( var r = 0; r < planets[i].resources.length; r++ ){

				var resource = planets[i].resources[r];
				var structure = resource.structure;

				if ( structure != undefined ) {
					
					// add 2 if a non-mine type of structure, otherwise use num
					var kind = structure.kind;
					var numToAdd = (kind == cons.OBJ_MINE ? resource.num : 2);

					if (structure.player == player) {
						resourceCollect[resource.kind] += numToAdd;
					}
				}
			}
		}
	}

	game.resourceCollect[player] = resourceCollect;
};

var calcResourceUpkeep = function( game, player ) {
	var resourceUpkeep = [0, 0, 0, 0];

	for ( var obj = cons.OBJ_MINE; obj <= cons.OBJ_FLEET; obj++ ){

		// get number of structures of type obj that are on board
		var num = cons.STRUCT_REQS[obj].max - game.structures[player][obj];
		// get upkeep object for this type of structure
		var upkeep = cons.STRUCT_REQS[obj].upkeep;

		for (var res in upkeep){
			resourceUpkeep[res] += (upkeep[res] * num);
		}
	}

	game.resourceUpkeep[player] = resourceUpkeep;
};

var updateTurn = function( game ){
	if(game.round == 0){
		if(game.secondmines) {
			game.turn -= 1;
			if (game.turn < 0) {
				game.turn = 0;
				game.round = 1;
				game.phase = cons.PHS_RESOURCE;
			}
		} else {
			game.turn += 1;
			if (game.turn >= game.players.length) {
				game.turn = game.players.length - 1;
				game.secondmines = true;
			}
		}
	} else {
		game.turn += 1;
		if ( game.turn >= game.players.length) {
			game.round += 1;
			game.turn = 0;
		}
	}
};

var updatePhase = function( game ){
	switch (game.phase) {
		case cons.PHS_RESOURCE:
		case cons.PHS_UPKEEP:
			if(game.phaseDone.indexOf(false) == -1){
				game.phase = (game.phase + 1) % 5;
				game.turn = 0;
				helpers.clearPhaseDone( game );
			}
			break;
		default:
			break;
	}
};

var hasEnoughToBuild = function( player, objecttype, game ) {
	var requirements = cons.STRUCT_REQS[objecttype].build;

	for (var res in requirements) {
		if ( game.resources[player][res] < requirements[res] ) {

			return false;

		}
	}

	return true;
};

var payToBuild = function( player, objecttype, game) {
	var requirements = cons.STRUCT_REQS[objecttype].build;

	for (var res in requirements) {
		game.resources[player][res] -= requirements[res];
	}
};

/**
 * This function currently just adds the number of points a structure
 * is worth when it is built. In the long-term, this is not very smart.
 * We should at least be considering the structure's location, whether
 * it has all borders blocked, etc.
 */
var addPointsForStructure = function( player, objecttype, planetid, game) {
	var value = cons.OBJ_VALUE[objecttype];
	game.points[player][cons.PNT_STRUCTURES] += value;
};

/**
 * Checks to see if the end condition for the game has been met
 * 
 * @return true or false
 */ 
var isEndCondition = function( game ) {
	return ( game.round >= 3 );
};