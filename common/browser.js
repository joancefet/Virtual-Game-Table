/**
 * This file is part of the Virtual Game Table distribution 
 * (https://github.com/jaxankey/Virtual-Game-Table).
 * Copyright (c) 2015-2019 Jack Childress (Sankey).
 * 
 * This program is free software: you can redistribute it and/or modify  
 * it under the terms of the GNU General Public License as published by  
 * the Free Software Foundation, version 3.
 *
 * This program is distributed in the hope that it will be useful, but 
 * WITHOUT ANY WARRANTY; without even the implied warranty of 
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU 
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License 
 * along with this program. If not, see <http://www.gnu.org/licenfses/>.
 */

/* 
BUG: Sometimes resets piece positions on reload
BUG (once): all the pieces started disappearing!?

TO DO: Redo this whole thing in PIXI.js, and overhaul netcode, now that I know what I'm doing. :)

TO DO: massive overhaul & code simplification:
  * all piece lists become id lists; function get_piece_by_id() 
  * combine all groups of parallel arrays into a single dictionary
  * use these dictionaries to send info to the server and back
  * all objects become server packets, and functions to draw, etc take 
    their instance as a first argument? This makes net traffic super simple.
  * Pieces have held_by value, rather than client_is_holding lists.
    var before every local variable. Avoids overwriting by other functions in loops!

TO DO: Find a way to switch back to the more responsive piece rotation in board.draw(). (Make incremental changes to piece coordinates, rather than setting targets?)
TO DO: Add new_piece_layer integer for automatic layered drawing. It has to naturally stay sorted, or 
       else is_tray will not work, and selecting pieces would be a problem. Perhaps board.pieces should be {0:[], 1:[], ...}? 
       Alternatively, insert_piece() could auto-sort by checking piece layers and incrementing/decrementing when out of order.
TO DO: Cookies assigned per web address AND game name.
*/

//// OPTIONS

var stream_interval_ms    = 150;   //150;   // how often to send a stream update (ms)
//var undo_interval_ms    = 2000; // how often to take an undo snapshot (ms)
var draw_interval_ms      = 10;   // how often to draw the canvas (ms)
var post_u_ignore_u_ms    = 1500; // how long to maintain control over a piece after rolling it (hadoken)

if(!window.chrome || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
  document.getElementById("everything").innerHTML = "<h2>Sorry, this requires the non-mobile Chrome web browser to run.<br><br>xoxoxo,<br>Jack</h2>";}

/**
 * USEFUL FUNCTIONS
 */

// Faster version of slow functions
function sin(r_deg) {

  // If it's the same value, return the previous result.
  if(r_deg == sin.r_deg) return sin.result;

  // Otherwise, calculate it and remember it
  sin.result = Math.sin(r_deg*Math.PI/180.0);
  sin.r_deg = r_deg;
  return sin.result;
}
function cos(r_deg) {

  // If it's the same value, return the previous result.
  if(r_deg == cos.r_deg) return cos.result;

  // Otherwise, calculate it and remember it
  cos.result = Math.cos(r_deg*Math.PI/180.0);
  cos.r_deg = r_deg;
  return cos.result;
}
function tan(r_deg) {

  // If it's the same value, return the previous result.
  if(r_deg == tan.r_deg) return tan.result;

  // Otherwise, calculate it and remember it
  tan.result = Math.tan(r_deg*Math.PI/180.0);
  tan.r_deg = r_deg;
  return tan.result;
}
function atand(x) {

  // If it's the same value, return the previous result.
  if(x == atand.x) return atand.result;

  // Otherwise, calculate it and remember it
  atand.result = Math.atan(x)*180.0/Math.PI;
  atand.x = x;
  return atand.result;
}
function sqrt(x) {

  // If it's the same value, return the previous result.
  if(x == sqrt.x) return sqrt.result;

  // Otherwise, calculate it and remember it
  sqrt.result = Math.sqrt(x);
  sqrt.x = x;
  return sqrt.result;
}

/**
 * Compares two multidimensional arrays.
 * @param {array} a1 
 * @param {array} a2 
 */
function array_compare(a1, a2) {
  
  // If they're both undefined, e.g.
  if(a1==a2) return true;
  
  if(a1.length != a2.length) return false;
  
  for(var i in a1) {
   // Don't forget to check for arrays in our arrays.
   if(a1[i] instanceof Array && a2[i] instanceof Array) {
    if(!array_compare(a1[i], a2[i])) return false;
   }
   else if(a1[i] != a2[i]) return false;
  }
  return true;
 }

// Generates a date string for logs
function get_date_string() {
  
  // get the date
  var today = new Date();
  var ss = today.getSeconds();
  var mm = today.getMinutes();
  var hh = today.getHours();
  var dd = today.getDate();
  var MM = today.getMonth()+1; //January is 0!
  var yyyy = today.getFullYear();
  
  // format the string
  if(ss<10) ss='0'+ss;
  if(hh<10) hh='0'+hh
  if(dd<10) dd='0'+dd;
  if(mm<10) mm='0'+mm;
  if(MM<10) MM='0'+MM;
  
  // return formatted
  console.log(ss)
  return yyyy+'-'+MM+'-'+dd+' '+hh+'.'+mm;
}

// get / set your team number
// These set the gui values, which trigger the event team_onchange()
function get_team_number()  {return document.getElementById("teams").selectedIndex;}
function set_team_number(n) {return document.getElementById("teams").selectedIndex = n;}

/**
 * Returns a list of team zone packets ready for the server
 */
function get_team_zone_packets() {
  var packets = [];
  for(n in board.team_zones) {
    if(board.team_zones[n]) packets.push(board.team_zones[n].to_packet());
    else                    packets.push(null);
  }
  return packets;
}

/**
 * Returns a list of active team indices.
 */
function get_active_teams(exclude) {
  var exclude = or_default([0,9], exclude); 

  var teams = [];
  for(n in board.client_teams) {

    // If we don't already have this team and it's not the observer or admin, add it to the list!
    if(!teams.includes(board.client_teams[n]) && !exclude.includes(board.client_teams[n]))
      teams.push(parseInt(board.client_teams[n]));
  }
  return teams;
}

/**
 * Sorts the provided array of pieces so that their order matches that of board.pieces.
 * @param {array} pieces 
 */
function sort_pieces_by_position(pieces) {
  pieces.sort(function(p1,p2) {return board.pieces.indexOf(p1)-board.pieces.indexOf(p2);});
  return pieces
}

/**
 * Sorts the provided array of pieces by their id number
 * @param {array} pieces 
 */
function sort_pieces_by_id(pieces) {
  pieces.sort(function(p1,p2) {return p1.id-p2.id;});
  return pieces
}

/**
 * Sorts the selected items.
 */
function sort_selected() {
  // Get the selected pieces
  sps = board.client_selected_pieces[get_my_client_index()]
  
  // Sort them
  board.sort_and_pop_pieces(sps);
}

/**
 * Scramble the supplied pieces, like rolling dice: randomizes locations in a pattern determined by the 
 * last piece's diameter, minimizing overlap. 
 * 
 * @param {array} pieces list of pieces to randomize
 * @param {int}   space  space occupied by each piece on average
 */
function scramble_pieces(pieces, x, y, space, scale) {
  if(!pieces || pieces.length==0) return;

  // First find the center of the pieces and the space taken by each
  var c = get_center_of_pieces(pieces);
  var x = or_default(x, c.x);
  var y = or_default(y, c.y);
  var space = or_default(space, 2);
  var scale = or_default(scale, 1);

  // Now find the basis vectors based on the radius of the last piece
  var d  = pieces[pieces.length-1].get_dimensions()
  var D  = scale*Math.sqrt(d.width*d.width+d.height*d.height);
  var ax = D;
  var ay = 0;
  var bx = ax*cos(60);
  var by = ax*sin(60);

  // Rotate the basis vectors by a random angle
  var r = 360*Math.random();
  var a = rotate_vector(ax, ay, r);
  var b = rotate_vector(bx, by, r);

  // Generate all the available hex grid indices, skipping the one below your hand.
  var spots =[]; for(var n=1; n<pieces.length*space+1; n++) spots.push(n);
  
  // Set the piece coordinates on the hex grid
  for(var n in pieces) {
    var p = pieces[n];
    var d = hex_spiral(spots.splice(rand_int(0, spots.length-1),1));
    var v = rotate_vector(0.25*D*Math.random(), 0, 360.0*(Math.random()));
    
    //           x,y,r,                        angle,disable_snap,immediate
    p.set_target(x + d.n*a.x + d.m*b.x + v.x, 
                 y + d.n*a.y + d.m*b.y + v.y, 
                 (Math.random()-0.5)*720*scale, null, true, false);
    p.active_image = rand_int(0, p.images.length-1);
  }
}

/**
 * Scramble the selected pieces, like rolling dice: randomizes locations in a pattern determined by the 
 * last piece's diameter, minimizing overlap. 
 */
function scramble_selected_pieces() {
  scramble_pieces(board.client_selected_pieces[get_my_client_index()]);
}


/**
 * Returns true if x,y is within the box.
 * @param {float} x 
 * @param {float} y 
 * @param {box} box 
 */
function is_within_selection_box(x,y,box) {
  var cs = get_selection_box_corners(box);

  // rotate all 5 points of interest so the comparison is easy.
  var rp = rotate_vector(x,y,-box.r);
  var r0 = rotate_vector(cs.x0, cs.y0, -box.r);
  var r1 = rotate_vector(cs.x1, cs.y1, -box.r);
  
  // now compare
  return rp.x >= Math.min(r0.x,r1.x) && rp.x <= Math.max(r0.x,r1.x) &&
         rp.y >= Math.min(r0.y,r1.y) && rp.y <= Math.max(r0.y,r1.y) ;
}

/**
 * Calculates the other two selection box corners based on the view rotation.
 * @param {box} box 
 * 
 * Returns {x0, y0, x1, y1, x2, y2, x3, y3}
 */
function get_selection_box_corners(box) {
  
  // Get the center
  var cx = (box.x0 + box.x1)*0.5;
  var cy = (box.y0 + box.y1)*0.5;
  
  // Get the half diagonal
  // TO DO: this is all very expensive for every piece!
  var a = Math.sqrt((box.y1-box.y0)*(box.y1-box.y0)+(box.x1-box.x0)*(box.x1-box.x0)) * 0.5;
 
  // Get the unrotated angle to the corner TO DO:
  var t  = atand((box.y1-cy)/(box.x1-cx));
  var x2 = cx + a*cos(t+2*box.r);
  var y2 = cy - a*sin(t+2*box.r);
  var x3 = 2*cx - x2;
  var y3 = 2*cy - y2;

  return {x0:box.x0, y0:box.y0,
          x1:box.x1, y1:box.y1,
          x2:x2,     y2:y2,
          x3:x3,     y3:y3}
}

/**
 * Use my client_id to find my index
 */
function get_my_client_index() {return board.client_ids.indexOf(board.client_id);}

// get / set your name
// These set the gui value, which in turn triggers the event name_onchange()
function get_name()     {return document.getElementById("name").value;}
function set_name(name) {return document.getElementById("name").value = name;}

// see if the peak box is checked
function get_peak() {return document.getElementById("peak").checked;}

// returns default_a if a is undefined
function or_default(a, default_a) {
  if(a !== undefined) return a;
  return default_a;
}

/**
 * Rotates the supplied x,y vector by angle r_deg, 
 * returning a dictionary with the rotated 'x' and 'y'.
 * @param {float} x x coordinate to rotate
 * @param {float} y y coordinate to rotate
 * @param {float} r angle with which to rotate (degrees)
 */
function rotate_vector(x,y,r) {
  
  // Only recompute cosine and sine if the angle is new.
  if(r != this.last_r) {
    
    // convert to radians & compute.
    this.last_r = r;
    this.cos_r = cos(r);
    this.sin_r = sin(r);
  }

  // rotate coordinates
  var x2 =  this.cos_r*x + this.sin_r*y;
  var y2 = -this.sin_r*x + this.cos_r*y;

  return({x:x2, y:y2});
}

function rotate_pieces(pieces, r_deg, immediate, x, y) {
  
  var immediate = or_default(immediate, false);
  var x         = or_default(x, null);
  var y         = or_default(y, null);

  // Get the center of the current target coordinates, and the origin target coordinates
  if(x == null || y == null) var d = get_center_of_pieces(pieces);
  else var d = {x:x,y:y};
  
  for(var i in pieces) 
    pieces[i].rotate(r_deg, d.x, d.y, immediate);
}

// randomizes the order of the supplied array (in place)
function shuffle_array(array) {
  var currentIndex = array.length, temporaryValue, randomIndex ;

  // While there remain elements to shuffle...
  while (0 !== currentIndex) {

    // Pick a remaining element...
    var randomIndex = rand_int(0, currentIndex-1);
    currentIndex -= 1;

    // And swap it with the current element.
    var temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }

  return array;
}

/**
 * Shuffles the selected pieces.
 * 
 * @param {int} active_image (optional) active image index
 * @param {float} r_piece (optional) otation of the piece
 * @param {float} r_stack (optional) rotation of the stack
 * @param {float} offset_x (optional) override the offset_x
 * @param {float} offset_y (optional) override the offset_y
 */
function shuffle_selected_pieces(active_image, r_piece, r_stack, offset_x, offset_y) {
  board.shuffle_pieces(board.client_selected_pieces[get_my_client_index()],
                       active_image, r_piece, r_stack, offset_x, offset_y)
}

/**
 * Shuffles the supplied pieces.
 * 
 * @param {array} pieces list of pieces to shuffle
 * @param {int} active_image (optional) active image index
 * @param {float} r_piece (optional) otation of the piece
 * @param {float} r_stack (optional) rotation of the stack
 * @param {float} offset_x (optional) override the offset_x
 * @param {float} offset_y (optional) override the offset_y
 */
function shuffle_pieces(pieces, active_image, r_piece, r_stack, offset_x, offset_y) {
  board.shuffle_pieces(pieces, active_image, r_piece, r_stack, offset_x, offset_y)
}

/**
 * Returns the coordinates of the center of mass of the supplied list of pieces.
 * @param {[]} pieces 
 */
function get_center_of_pieces(pieces) {
  var xmin  = null;
  var xmax  = null;
  var ymin  = null;
  var ymax  = null;
  
  for(var n in pieces) {
    var p = pieces[n];
    if(xmin==null || p.x_target < xmin) xmin = p.x_target;
    if(xmax==null || p.x_target > xmax) xmax = p.x_target;
    if(ymin==null || p.y_target < ymin) ymin = p.y_target;
    if(ymax==null || p.y_target > ymax) ymax = p.y_target;
  }
  return {x:0.5*(xmin+xmax), y:0.5*(ymin+ymax)};
}

/**
 * Converts an integer into an integer basis vector {m,n} following a hexagonal spiral from 
 * {m:0,n:0}
 * @param {int} n step.
 */
function hex_spiral(n) {

  // return the origin to avoid explosions if n=0
  if(n==0) return {n:0, m:0}

  // get the index of the shell
  var s = Math.ceil(Math.sqrt(0.25+n/3.0)-0.5);

  // zero index of this shell
  var n0 = 6*s*(s-1)/2+1;

  // Declarations
  var x0 = null;
  var y0 = null;
  var dx0 = null;
  var dy0 = null;
  
  // depending which of the 6 legs we're on get the vectors
  var leg = Math.floor((n-n0)/s);
  switch(leg) {
    case 0: x0 =  s; y0 =  0; dx0 = -1;  dy0 =  1; break;
    case 1: x0 =  0; y0 =  s; dx0 = -1;  dy0 =  0; break;
    case 2: x0 = -s; y0 =  s; dx0 =  0;  dy0 = -1; break;
    case 3: x0 = -s; y0 =  0; dx0 =  1;  dy0 = -1; break;
    case 4: x0 =  0; y0 = -s; dx0 =  1;  dy0 =  0; break;
    case 5: x0 =  s; y0 = -s; dx0 =  0;  dy0 =  1; break;
  }

  // which element of the 6 legs we're on
  var i = n-n0-leg*s;

  // assemble the grid snap
  return {n:x0+i*dx0, m:y0+i*dy0};
}

/**
 * Returns a list of n unique random lattice index pairs [nx,ny] from a hex spiral of length N.
 * Hint: N had better be larger than n.
 * @param {int} spaces 
 * @param {int} items 
 */
function hex_spiral_random(n,N) {

  // Generate the list of hex spiral inputs
  possible_ns = [...Array(N).keys()];

  // Loop over the number of desired pairs
  pairs = [];
  for(var i=0; i<n; i++) {
    j = possible_ns.splice(rand_int(0, possible_ns.length-1),1);
    console.log(i,possible_ns, j);
    pairs.push(hex_spiral(j));
  }
  return pairs;
}

// returns a random integer over the specified bounds
function rand_int(m,n) { 
  var y = Math.floor(Math.random()*(1+n-m))+m; 

  // exceedingly rare case
  if(y > n) y = n;

  return y;
}

// returns true if (x,y) is below / to the left of the line defined by (x1,y1) and (x2,y2)
function is_below_line(x,y, x1,y1, x2,y2) {

  // if the slope is infinite
  if(x1==x2) return x < x1;
  
  // if the slope is zero
  if(y1==y2) return y < y1;
  
  // see if it's below the line (depends on sign of slope)
  if( (y2-y1)/(x2-x1) > 0 ) return ( y < (y2-y1)*(x-x1)/(x2-x1) + y1 && x > (x2-x1)*(y-y1)/(y2-y1) + x1 );
  else                      return ( y < (y2-y1)*(x-x1)/(x2-x1) + y1 && x < (x2-x1)*(y-y1)/(y2-y1) + x1 );
}




///////////////////
// PIECE OBJECT
///////////////////

/**
 * Piece constructor. Note the games do not directly use this, rather they
 * call board.add_piece(['list.png','of.png','images.png'],['private.png','images.png','optional.png'])
 * which assigns a unique id and creates the images from their paths.
 * @param {BOARD} board             // board instance 
 * @param {*} id              // unique id for the piece
 * @param {*} image_paths           // list of public (visible to everyone) impage path strings
 * @param {*} private_image_paths   // list of private (visible to team) image path strings
 *                                  // if not specified, these are identical to the image_paths
 * @param {*} avatar                // If true, doesn't prepend /images to the path
 */
function PIECE(board, id, image_paths, private_image_paths, scale) {

  // by default, use the same set of image paths
  private_image_paths = or_default(private_image_paths, image_paths);
  
  // equivalent of storing object properties (or defaults)
  this.board                     = board;                        // board instance for this piece
  this.id                        = id;                     // unique piece id
  this.image_paths               = image_paths;                  // list of available images (seen by everyone)
  this.private_image_paths       = private_image_paths;          // list of available private image path strings, e.g. 'pants.png' (seen by team)
  this.private_images_everywhere = this.board.new_piece_private_images_everywhere; // Whether the private image is also visible outside the team zone.
  this.owners                    = this.board.new_piece_owners;  // list of who owns this piece (private images)
  this.is_tray                   = this.board.new_piece_is_tray; // whether selecting this piece selects those within its bounds and above it.
  this.collect_offset_x          = this.board.new_piece_collect_offset_x;
  this.collect_offset_y          = this.board.new_piece_collect_offset_y;
  this.scale                     = or_default(scale, board.new_piece_scale);
  this.width                     = this.board.new_piece_width;
  this.height                    = this.board.new_piece_height;
  this.danger_image_index        = this.board.new_piece_danger_image_index;

  // Index in the main piece stack (determines drawing order)
  this.previous_n = null;

  // Target values.
  this.x_target  = this.board.new_piece_x_target;
  this.y_target  = this.board.new_piece_y_target;
  this.r_target  = this.board.new_piece_r_target;
  this.r_step    = this.board.new_piece_r_step;
  
  // Instantaneous values
  this.x  = this.board.new_piece_x_target;
  this.y  = this.board.new_piece_y_target;
  this.r = this.board.new_piece_r_target;
  
  this.t_fade_ms        = this.board.new_piece_t_fade_ms;
  this.snap_index       = this.board.new_piece_snap_index;
  this.movable_by       = this.board.new_piece_movable_by;
  this.peakable_by      = this.board.new_piece_peakable_by;
  this.active_image     = this.board.new_piece_active_image;
  this.alpha            = this.board.new_piece_alpha;

  // When we last sent an update (milliseconds)
  this.t_last_update_ms = 0;

  // where it belongs in the box
  this.box_x = this.board.new_piece_box_x;
  this.box_y = this.board.new_piece_box_y;
  
  // Whether or not the rotation / zoom affects the piece.
  this.rotates_with_canvas = this.board.new_piece_rotates_with_canvas;
  this.zooms_with_canvas   = this.board.new_piece_zooms_with_canvas;
  
  // set the default physical shape
  switch(this.board.new_piece_physical_shape) {
    case "ellipse":       
      this.physical_shape = this.ellipse; 
      break;
    case "rectangle":     
      this.physical_shape = this.rectangle; 
      break;
    case "outer_circle":  
      this.physical_shape = this.outer_circle;
      break;
    case "inner_circle":  
      this.physical_shape = this.inner_circle;
      break;
  }
  
  // images associated with this piece
  this.images         = [];
  this.private_images = [];

  // loop over the paths and load up the images
  for (var i=0; i<this.image_paths.length; i++) {

    // make sure we haven't loaded it already
    if( this.image_paths[i] in this.board.images ) {
      
      // use the existing image
      this.images.push(this.board.images[this.image_paths[i]]);
    
    // otherwise we need to load it
    } else {
    
      // tell Jack that we're loading it...
      console.log("  loading "+this.image_paths[i]);

      // create the image object
      var I = new Image();
      this.images.push(I);
      if(this.image_paths[i].slice(0,7) == 'common/' || 
         this.image_paths[i].slice(0,8) == 'private/') 
           I.src =        '/' + this.image_paths[i];
      else I.src = '/images/' + this.image_paths[i];
      
      // store this image for the future
      this.board.images[this.image_paths[i]] = I;
    }
  }
  
  // loop over the private image paths and load up the images
  for (var i=0; i<this.private_image_paths.length; i++) {

    // make sure we haven't loaded it already
    if( this.private_image_paths[i] in this.board.images ) {
      
      // use the existing image
      this.private_images.push(this.board.images[this.private_image_paths[i]]);
    
    // otherwise we need to load it
    } else {
    
      // tell Jack that we're loading it...
      console.log("  loading /images/"+this.private_image_paths[i]);

      // create the image object
      var I = new Image();
      this.private_images.push(I);
      I.src = '/images/'+this.private_image_paths[i];
      
      // store this image for the future
      this.board.images[this.private_image_paths[i]] = I;
    }
  }

  // current velocity of motion (to add momentum)
  this.vx = 0;
  this.vy = 0;
  this.vr = 0;

  // last time this piece was moved / drawn
  this._t_previous_draw = Date.now();
  this.t_previous_move = this._t_previous_draw;
  
  // keep track of the previous target to reduce reduntant server info
  this.previous_x = this.x_target;
  this.previous_y = this.y_target;
  this.previous_r = this.r_target;
  this.previous_active_image = this.active_image;
} // end of PIECE

/**
 * Sends the piece to position n.
 */
PIECE.prototype.send_to = function(n) {

  // Get the current index for popping.
  var n0 = this.board.find_piece_index(this.id);

  // Pop it
  this.board.pop_piece(n0);

  // Now insert it at the new location
  this.board.insert_piece(this, n);
  
  return this;
}

/**
 * Send the piece to the bottom of the stack.
 */
PIECE.prototype.send_to_bottom = function() {
  this.send_to(0);
  return this;
}

/**
 * Send the piece to the top of the stack.
 */
PIECE.prototype.send_to_top = function() {
  this.send_to(this.board.pieces.length);
  return this;
}

// Put it in its box;
PIECE.prototype.put_away = function() {
  
  // x,y,r,angle,disable_snap,immediate
  this.set_target(this.board.box_x+this.box_x, this.board.box_y+this.box_y, 0, null, true, false);
  return this;
}

// set the image by index
PIECE.prototype.set_active_image = function(i) {
  this.active_image = i;
  return this;
}

// Increment the active image
PIECE.prototype.increment_active_image = function(randomize) {
  
  // Randomize the image
  if(randomize) this.active_image = Math.floor(Math.random()*this.images.length);
  
  // Cycle the image
  else {
    this.active_image++;
    if(this.active_image >= this.images.length) this.active_image = 0;
  }
}

// Returns a vector {width, height, max, min} for the current active image.
PIECE.prototype.get_dimensions = function() {
  if(this.width != null) {var w = this.width;}
  else                   {var w = this.images[this.active_image].width;}
  
  if(this.height != null) {var h = this.height;}
  else                    {var h = this.images[this.active_image].height;}
  return {width: w, height: h, max: Math.max(w, h), min: Math.min(w, h)};
}

// set the target location x,y and rotation r, and everything rotated about the board origin by angle
PIECE.prototype.set_target = function(x,y,r,angle,disable_snap,immediate) {

  // Set default argument values
  x            = or_default(x, this.x_target);
  y            = or_default(y, this.y_target);
  r            = or_default(r, null);
  angle        = or_default(angle, null);        
  disable_snap = or_default(disable_snap, false);
  immediate    = or_default(immediate, false);

  // Always disable if held. This causes a single piece to not be let go on mouseup!
  //disable_snap = disable_snap || board.find_holding_client_index(this) >= 0;

  // if we're supposed to transform the coordinates
  if(angle != null) {
    var v = rotate_vector(x, y, angle);
    r = r-angle;
    x = v.x;
    y = v.y;
  }
  
  // if we're supposed to snap
  if(this.snap_index != null && !disable_snap) {
    
    // apply the snap
    var snapped = this.board.snap_grids[this.snap_index].get_snapped_coordinates(x,y);
    x = snapped.x;
    y = snapped.y;
  }

  // set the target
  this.x_target  = x;
  this.y_target  = y;

  // if immediate, go there without animation
  if (immediate) {
    this.x = x;
    this.y = y;
  }

  // set the rotation if not null
  if(r != null) this.set_rotation(r, immediate);
  
  // reset the clock (if not immediate) & trigger a redraw
  if(!immediate) this._t_previous_draw = Date.now();
  this.board.trigger_redraw = true;

  // return the handle to the piece
  return this;
}
PIECE.prototype.set_target_grid = function(n,m,r_deg) {
  
  // defaults
  r_deg = or_default(r_deg, null);
  
  // get the grid
  var g = this.board.snap_grids[this.snap_index];
  
  // x,y,r,angle,disable_snap,immediate,set_origin
  if(g != null) this.set_target(g.x0+n*g.dx1+m*g.dx2, 
                                g.y0+n*g.dy1+m*g.dy2, r_deg, null, true);
  
  return this;
}
PIECE.prototype.set_rotation = function(r_deg, immediate) {
  immediate = or_default(immediate, false);
  
  // set the target
  this.r_target         = r_deg;
  if (immediate) this.r = r_deg;
  
  // reset the clock & trigger a redraw
  if(!immediate) this._t_previous_draw = Date.now();
  this.board.trigger_redraw = true;
  
  // return the handle to the piece
  return this;
}


/**
 * Rotates a piece about the (optional) supplied origin (x0,y0).
 */
PIECE.prototype.rotate = function(r_deg, x0, y0, immediate) {

  // By default, rotate the piece about its own center.
  var x0 = or_default(x0, this.x_target);
  var y0 = or_default(y0, this.y_target);
  var immediate = or_default(immediate, false);

  // If specified, rotate about the supplied center coordinate
  if(x0 != this.x_target || y0 != this.y_target) {
    var d = rotate_vector(this.x_target-x0, this.y_target-y0, -r_deg);
    if(this.rotates_with_canvas)
      this.set_target(x0 + d.x, y0 + d.y, r_deg + this.r_target, null, true, immediate);
    else
      this.set_target(x0 + d.x, y0 + d.y,         this.r_target, null, true, immediate);
  }
  
  // Otherwise rotate around its center.
  else this.set_rotation(r_deg + this.r_target, immediate);
}



PIECE.prototype.ellipse  = function(x, y) {
  
  // if this piece has an angle, do the transform
  var r_deg = this.r;
  
  // if this piece does not rotate with the board
  if (this.rotates_with_board) r_deg = r_deg-this.board.r;
  
  // get rotated coordinates
  var d = rotate_vector(x-this.x, y-this.y, r_deg);
  
  // get width and height
  var x = this.get_dimensions();
  var w = this.scale*0.5*x.width;
  var h = this.scale*0.5*x.height;
  
  // elliptical bounds
  return d.x*d.x/(w*w) + d.y*d.y/(h*h) <= 1;
}
PIECE.prototype.outer_circle  = function(x, y) {
  
  // if this piece has an angle, do the transform
  var r_deg = this.r;
  
  // if this piece does not rotate with the board
  if (this.rotates_with_board) r_deg = r_deg-this.board.r;
  
  // get rotated coordinates
  var d = rotate_vector(x-this.x, y-this.y, r_deg);
  
  // get width
  var x = this.get_dimensions();
  var w = this.scale*Math.max(0.5*x.width, 0.5*x.height);
  
  // circular bounds
  return d.x*d.x + d.y*d.y <= w*w;
}
PIECE.prototype.inner_circle  = function(x, y) {
  
  // if this piece has an angle, do the transform
  var r_deg = this.r;
  
  // if this piece does not rotate with the board
  if (this.rotates_with_board) r_deg = r_deg-this.board.r;
  
  // get rotated coordinates
  var d = rotate_vector(x-this.x, y-this.y, r_deg);
  
  // get width
  var x = this.get_dimensions();
  w = this.scale*Math.min(0.5*x.width, 0.5*x.height);
  
  // circular bounds
  return d.x*d.x + d.y*d.y <= w*w;
}
PIECE.prototype.rectangle = function(x,y) {
  
  // if this piece has an angle, do the transform
  var r_deg = this.r;
  
  // if this piece does not rotate with the board
  if (this.rotates_with_board) r_deg = r_deg-this.board.r;
  
  // get rotated coordinates
  var d = rotate_vector(x-this.x, y-this.y, r_deg);
  
  // rectangular bounds
  var x = this.get_dimensions();
  return (Math.abs(d.x) <= this.scale*0.5*x.width 
       && Math.abs(d.y) <= this.scale*0.5*x.height);
}

// Returns true if x,y are in the piece bounds
PIECE.prototype.contains = function(x, y) {
  
  // Determine if a point is inside the PIECE's bounds
  if(this.images[this.active_image]) return this.physical_shape(x,y);
  else return false
}

PIECE.prototype.on_image_load   = function(e) {
    
    return;
    
}
PIECE.prototype.needs_redraw    = function() {
  
  // PIECE needs a draw if its coordinates are not equal to the target values
  return (this.x != this.x_target ||
          this.y != this.y_target ||
          this.r != this.r_target ||
          Date.now()-this.t_previous_move <= this.t_fade_ms);
}

// draws the selection rectangle or whatever around the piece.
PIECE.prototype.draw_selection = function(fill) {
  
  var context = this.board.context;

  // Nothing to draw!
  if(!this.images[this.active_image]) return;
  
  // get the piece dimensions
  var x = this.get_dimensions();
  var w = x.width;
  var h = x.height;

  // if we're not allowed to zoom, adjust the size
  if(!this.zooms_with_canvas) {
    w = w*100.0/this.z;
    h = h*100.0/this.z;
  }

  // Rescale.
  w = w*this.scale;
  h = h*this.scale;

  switch(this.physical_shape) {
    
    case this.rectangle:
      context.beginPath();
      context.rect(-0.5*w,-0.5*h, w, h);
      context.stroke();
      break;

    case this.outer_circle:
    case this.ellipse:
      context.beginPath();
      context.arc(0,0, Math.max(w,h)*0.5, 0, 2*Math.PI);
      context.stroke();
      break;
   
    case this.inner_circle:
      context.beginPath();
      context.arc(0,0, Math.min(w,h)*0.5, 0, 2*Math.PI);
      context.stroke();
      break;
  }
  if(fill) {
    context.fill();
  }
}

PIECE.prototype.move_and_draw = function() {
  
  // Draws this PIECE to the context
  var context = this.board.context;
  
  // dynamics
  var speed = this.board.transition_speed;
  var accel = this.board.transition_acceleration;
  var snap  = this.board.transition_snap;
  
  // update the time and time since last draw
  var t  = Date.now();
  var dt = t - this._t_previous_draw;
  this._t_previous_draw = t;

  // calculate the target velocity
  var vx_target  = (this.x_target - this.x)*speed;
  var vy_target  = (this.y_target - this.y)*speed;
  var vr_target  = (this.r_target - this.r)*speed;
  
  // calculate the actual velocity after acceleration
  this.vx  = (vx_target  - this.vx) *accel;
  this.vy  = (vy_target  - this.vy) *accel;
  this.vr  = (vr_target  - this.vr) *accel;
  
  // adjust the step size
  var dx  = this.vx  * dt/draw_interval_ms;
  var dy  = this.vy  * dt/draw_interval_ms;
  var dr  = this.vr  * dt/draw_interval_ms;
  
  // make sure it's not too big
  if (Math.abs(dx) > Math.abs(this.x_target-this.x)) dx = this.x_target-this.x;
  if (Math.abs(dy) > Math.abs(this.y_target-this.y)) dy = this.y_target-this.y;
  if (Math.abs(dr) > Math.abs(this.r_target-this.r)) dr = this.r_target-this.r;
  
  // Calculate the new coordinates
  this.x  = dx + this.x;
  this.y  = dy + this.y;
  this.r  = dr + this.r;
  
  // round to the nearest pixel if we've hit the target
  if ( Math.abs(this.x-this.x_target) < snap && Math.abs(this.y-this.y_target) < snap) {
    this.x = this.x_target;
    this.y = this.y_target;
  }
  if ( Math.abs(this.r-this.r_target) < snap) {
    //this.r_target = this.r_target % 360;
    this.r        = this.r_target;
  }

  // change the active image if it's peakable
  if (this.peakable_by != null){ // if this is a peakable piece
    
    // if our team is in the peak list, set the index by the peak mode
    if( this.peakable_by.indexOf(get_team_number())>=0 && get_peak()) this.active_image = 1;
    
    // otherwise set to zero
    else this.active_image = 0; 
  }
  
  // by default, use the public image set, and we are NOT doing private images.
  var images  = this.images;
  var private = false;
  
  // if our team is in the owner list for this piece
  if(this.owners != null && 
     this.owners.indexOf(get_team_number()) > -1 &&
     
     // and we're supposed to see private images everywhere
     this.private_images_everywhere) {

        // use the private images for sure.
        images  = this.private_images;
        private = true;
  
  // otherwise, loop over the team zones to see if we should use private images.
  } else {
	  for(var n=0; n<this.board.team_zones.length; n++) {

		  // if the piece is in our own team zone, use the private images
		  if(n == get_team_number() 	      && 
			 this.board.team_zones[n] != null && 
			 this.board.team_zones[n].contains(this.x, this.y)) {
			 
			// switch image sets 
      images  = this.private_images;
      private = true;
			break; // Found a reason to quit the loop
		  }
	  }
  } 
  
  // draw it if there is an active image index and an image to draw.
  if(this.active_image != null && images[this.active_image]) {
    
    // Calculate the new alpha.
    if(this.t_fade_ms) {
      
      // if we moved this time
      if(dx || dy) this.t_previous_move = t;

      // calculate the new alpha
      dt = t-this.t_previous_move;

      // smooth fade function
      if(dt > this.t_fade_ms) a = 0;
      else a = this.alpha*(1.0 - Math.pow(1.0-Math.pow(dt/this.t_fade_ms-1.0, 2),8));

    } else a = this.alpha;
    // End of alpha calculation

    // set the alpha
    context.globalAlpha = a;
    
    // get the piece dimensions
    var w = images[this.active_image].width;
    var h = images[this.active_image].height;
    
    // if we're not allowed to zoom
    if(!this.zooms_with_canvas) {
      w = w*100.0/this.board.z;
      h = h*100.0/this.board.z;
    }

    // scale it
    w = w*this.scale;
    h = h*this.scale;
    
    // shift to where we're drawing the piece
    context.translate(this.x,this.y);
    
    // set the internal rotation
    context.rotate(this.r*Math.PI/180.0);
    
    // If the piece is not supposed to rotate, transform
    if(!this.rotates_with_canvas) context.rotate(-this.board.r*Math.PI/180.0);
    
    // draw the piece
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
	  context.drawImage(images[this.active_image], -0.5*w, -0.5*h, w, h);
    
    // If danger_image_index is enabled and the danger image is showing, add some color!
    if(private && this.danger_image_index != null && this.danger_image_index == this.active_image) {
      
      // draw white background
      context.strokeStyle = '#FFFFFF00';
      context.fillStyle   = '#FFFFFF70'
      context.lineWidth   = 0;
      this.draw_selection(true);
      
      // Glow
      context.strokeStyle = '#FFFFFF10';
      for(var i=2; i<15; i++) {
        context.lineWidth = board.selected_border_width*i*20.0/board.z; 
        this.draw_selection();
      }
    }

    // unrotate
    context.rotate(-this.r*Math.PI/180.0);
    
    // If the piece is not allowed to rotate, untransform
    if(!this.rotates_with_canvas) context.rotate(this.board.r*Math.PI/180.0);
    
    // unshift
    context.translate(-this.x,-this.y);
    
    // reset the alpha
    context.globalAlpha = 1.0;
  }
  
 
}


/**
 * Object for drawing team zones and hiding pieces within said zone.
 * @param {BOARD} board instance of the BOARD object 
 * @param {int} team_index index of the team
 * @param {float} x1 coordinates of the first corner
 * @param {float} y1 
 * @param {float} x2 coordinates of the second corner
 * @param {float} y2 
 * @param {float} x3 coordinates of the third corner
 * @param {float} y3 
 * @param {float} x4 coordinates of the fourth corner
 * @param {float} y4 
 * @param {float} r  angle (deg) of team zone
 * @param {float} alpha how opaque to make it (0-1)
 * @param {int} draw_mode draw draw_mode: 0=bottom, 1=top
 * @param {int} grab_mode piece grabbing: 0=Only team, 1=anyone
 */
function TEAMZONE(board, team_index, x1, y1, x2, y2, x3, y3, x4, y4, r, alpha, draw_mode, grab_mode) {

  // internal data that cannot be adjusted
  this.board      = board;
  this.team_index = team_index;
  
  // Default optional zone parameters
  var r         = or_default(r, 0);
  var alpha     = or_default(alpha, 1.0);
  var draw_mode = or_default(draw_mode, 1); // 0 = draw on bottom (table), 1 = draw on top (opaque)
  var grab_mode = or_default(grab_mode, 0);

  // Set the parameters but don't broadcast (goes with send_full_update(), or is sent by server)
  this.set_zone_parameters(x1, y1, x2, y2, x3, y3, x4, y4, r, alpha, draw_mode, grab_mode, false);
  
  console.log('New Team Zone', team_index);
}

/**
 * Sets the teamzone parameters.
 */
TEAMZONE.prototype.set_zone_parameters = function(x1, y1, x2, y2, x3, y3, x4, y4, r, alpha, draw_mode, grab_mode, broadcast) {
  
  var broadcast = or_default(broadcast, true);

  this.x1 = or_default(x1, this.x1); 
  this.y1 = or_default(y1, this.y1);
  this.x2 = or_default(x2, this.x2); 
  this.y2 = or_default(y2, this.y2);
  this.x3 = or_default(x3, this.x3); 
  this.y3 = or_default(y3, this.y3);
  this.x4 = or_default(x4, this.x4); 
  this.y4 = or_default(y4, this.y4);
  
  this.r          = or_default(r, this.r);
  this.alpha      = or_default(alpha, this.alpha);
  this.draw_mode  = or_default(draw_mode, 1);  
  this.grab_mode  = or_default(grab_mode, 0);

  // Tell everyone else.
  if(board._ready_for_packets && broadcast) {
    console.log('Sending_tz', this.team_index);
    my_socket.emit('tz', this.get_packet());
  }
}

TEAMZONE.prototype.get_packet = function() {
  return {
    team_index:this.team_index,
    x1:this.x1, y1:this.y1,
    x2:this.x2, y2:this.y2,
    x3:this.x3, y3:this.y3,
    x4:this.x4, y4:this.y4,
    r:this.r, alpha:this.alpha,
    draw_mode:this.draw_mode,
    grab_mode:this.grab_mode
  }
}

/**
 * Returns the server packet version of the team zone.
 */
TEAMZONE.prototype.to_packet = function() {
  return {
    team_index: this.team_index,
    draw_mode:  this.draw_mode,
    grab_mode:  this.grab_mode,
    x1: this.x1, y1: this.y1,
    x2: this.x2, y2: this.y2,
    x3: this.x3, y3: this.y3,
    x4: this.x4, y4: this.y4,
    r: this.r,
    alpha: this.alpha
  }
}

TEAMZONE.prototype.contains = function(x,y) {
  
  // rotate into the team zone's coordinates
  v = rotate_vector(x,y, -this.r);
  
  // checks whether it is bounded by the four lines (look for zero slope!)
  return ( !is_below_line(v.x,v.y, this.x1,this.y1, this.x2,this.y2) &&
           !is_below_line(v.x,v.y, this.x2,this.y2, this.x3,this.y3) &&
            is_below_line(v.x,v.y, this.x3,this.y3, this.x4,this.y4) &&
           !is_below_line(v.x,v.y, this.x4,this.y4, this.x1,this.y1));
}

TEAMZONE.prototype.draw = function() {

  // draw the polygon defining the team zone; it is assumed that this occurs after the z / pan / rotation
  // has been applied to the canvas (i.e. like how pieces are drawn)
  c = this.board.context;
  
  // save and set the alpha
  old_alpha     = c.globalAlpha;
  c.globalAlpha = this.alpha;
  
  // rotate
  c.rotate(-this.r*Math.PI/180.0);
  
  // draw the polygon
  c.strokeStyle = this.board.team_colors[this.team_index];
  c.fillStyle   = this.board.team_colors[this.team_index];
  c.lineWidth   = 4*100.0/this.board.z;
  
  c.beginPath();
  c.moveTo(this.x1, this.y1);
  c.lineTo(this.x2, this.y2);
  c.lineTo(this.x3, this.y3);
  c.lineTo(this.x4, this.y4);
  c.closePath();
  c.fill();
  
  // reset the alpha
  c.globalAlpha = old_alpha;
  
  // unrotate
  c.rotate(this.r*Math.PI/180.0);
}

//// SNAP GRID OBJECT

// Constructor
function SNAPGRID(x_left, y_top, width, height, x0, y0, dx1, dy1, dx2, dy2) {
  
  console.log("Creating snap grid...")
  
  // region
  this.x_left   = or_default(x_left, 10);
  this.y_top    = or_default(y_top,  10);
  this.width    = or_default(width,  100);  
  this.height   = or_default(height, 100);

  // origin of grid
  this.x0       = or_default(x0, 0);   
  this.y0       = or_default(y0, 0);
  
  // basis vectors
  this.dx1      = or_default(dx1, 10);   
  this.dy1      = or_default(dy1, 0);

  this.dx2      = or_default(dx2, 0);
  this.dy2      = or_default(dy2, 10);
  
}

// Methods
SNAPGRID.prototype.get_snapped_coordinates = function(x,y) {
  
  
  // make sure we're within the bounds
  if (x >= this.x_left && x-this.x_left <= this.width
   && y >= this.y_top  && y-this.y_top  <= this.height) {
    
    // shift coordinates relative to the origin
    x = x - this.x0;
    y = y - this.y0;
    
    // find the number of basis vectors required to get there
    N1 = (x*this.dy2-y*this.dx2) / (this.dx1*this.dy2-this.dy1*this.dx2);
    N2 = (x*this.dy1-y*this.dx1) / (this.dx2*this.dy1-this.dy2*this.dx1);
    
    // Snap it
    N1 = Math.round(N1);
    N2 = Math.round(N2);
    
    // update coordinates
    x = this.x0 + N1*this.dx1 + N2*this.dx2;
    y = this.y0 + N1*this.dy1 + N2*this.dy2;
  }
  
  return { x:x, y:y };
  
}



//// BOARD OBJECT

// Constructor
function BOARD(canvas) {

  console.log("Creating a new board...")
  
  //// options
  this.shuffle_distance        = 100;      // How far to randomize when shuffling.
  this.focus_zoom_level        = 180;      // zoom level of the F key.
  this.r_home                  = 0;        // where the escape key will take you
  this.pan_step                = 400;
  this.hand_fade_ms            = 1000;     // how long before motionless hands disappear
  this.transition_speed        = 0.35;     // max rate of piece motion
  this.transition_acceleration = 0.15;     // rate of acceleration
  this.transition_snap         = 0.1;      // how close to be to snap to the final result
  this.collect_r_piece         = null;     // what rotation to apply to collected pieces (null means view rotation)
  this.collect_r_stack         = null;     // what rotation to apply to collected pieces (null means view rotation)
  this.expand_spacing_x        = 50;       // how wide to space things when xpanding (x key)
  this.expand_spacing_y        = 50;       // how wide to space things when xpanding (x key)
  this.expand_number_per_row   = 10;       // how many pieces per row when xpanding 
  this.expand_r                = 0;        // What rotation to apply to xpanded pieces (null works, too)
  this.bottom_index            = 0;

  // Undo array
  //this.undos = [];
  //this.max_undos = 1000;
  //this.redos = [];

  // needed to distinguish cookies from different games
  this.game_name = 'default';
  
  // TO DO: Turn this into a piece shell with default values?

  // defaults for new pieces
  this.new_piece_x_target            = 0;
  this.new_piece_y_target            = 0;
  this.new_piece_r_target            = 0;
  this.new_piece_r_step              = 90;
  this.new_piece_t_fade_ms           = 0;
  this.new_piece_snap_index          = null;
  this.new_piece_movable_by          = null;
  this.new_piece_peakable_by         = null;
  this.new_piece_private_images_everywhere = false;
  this.new_piece_active_image        = 0;
  this.new_piece_rotates_with_canvas = true;
  this.new_piece_zooms_with_canvas   = true;
  this.new_piece_scale               = 1.0;
  this.new_hand_scale                = 1.0;
  this.new_avatar_scale              = 1.0;
  this.new_piece_physical_shape      = 'rectangle';
  this.new_piece_alpha               = 1.0;
  this.new_piece_box_x               = 0;
  this.new_piece_box_y               = 0;
  this.new_piece_owners              = null;
  this.new_piece_is_tray             = false;
  this.new_piece_collect_offset_x    = 2;        // how much to shift each piece when collecting
  this.new_piece_collect_offset_y    = 2;        // how much to shift each piece when collecting
  this.new_piece_width               = null;
  this.new_piece_height              = null;
  this.new_piece_danger_image_index  = null;

  // master list of all image names and objects, used to prevent double-loading
  this.images = {};
  
  
  //// INTERNAL DATA
  this._ready_for_packets = false;
  this._hadoken_charge_t0 = null; // pre-scramble keydown time.

  // canvas and context for drawing
  this.canvas  = canvas;
  this.context = canvas.getContext('2d');

  // lists of pieces and hands
  this.pieces       = [];    // the collection of things to be drawn
  this.piece_lookup = {};    // dictionary to get the piece by id
  
  this.selected_border_width    = 4;
  this.snap_grids               = [];
  
  // one border, zone, selected piece list for each team
  this.team_colors                   = [];
  this.team_zones                    = [];  
  this.team_hand_images              = [];
  this.managers = [];

  // Each client has a unique id, name, team index, and list of held pieces.
  // We leave these as separate lists to aid setting to new values from the server.
  this.client_id                       = -1; // Our server-assigned client id.
  this.client_ids                      = []; // List of server-assigned client ids.
  this.client_names                    = []; // List of strings supplied by server.
  this.client_teams                    = []; // List of integers supplied by server.
  this.client_hands                    = []; // List of hand objects (PIECEs)
  this.client_selected_pieces          = []; // List of selected pieces for each client.
  this.client_previous_selected_pieces = []; // List of previously selected pieces (for detecting changes)
  this.client_selection_boxes          = []; // Selection rectangle (dictionary with coordinates)
  this.client_is_holding               = []; // List of true and false, one for each client about whether they're holding their selection

  // Drag offset coordinates for canvas moving
  this.drag_offset_board_x = null;
  this.drag_offset_board_y = null;
  this.drag_offset_screen_x= null;
  this.drag_offset_screen_y= null;

  this._prefocus_px = 0;
  this._prefocus_py = 0;
  this._prefocus_r  = 0;
  this._prefocus_zoom_level  = 0;

  // the box coordinates for all the unused game pieces
  this.box_x = 0;
  this.box_y = -3000;
  
  // default shortcut keys (1-9) locations
  this.shortcut_coordinates = [
    [0,0,100,0],   // 1
    [0,0,100,45],  // 2
    [0,0,100,90],  // 3
    [0,0,100,135], // 4
    [0,0,100,180], // 5
    [0,0,100,225], // 6
    [0,0,100,270], // 7
    [0,0,100,315], // 8
    [0,0,100,0],   // 9
  ]

  // we use this to recognize when the mouse state has changed 
  // (avoids sending too many events too quickly to the server)
  this.mouse              = {x:0, y:0, e:{offsetX:0, offsetY:0}};
  this.previous_mouse     = {x:0, y:0, e:{offsetX:0, offsetY:0}};

  // This is a faster version of previous mouse that is updated every mousemove event.
  this._previous_mousemove = {x:0, y:0, e:{offsetX:0, offsetY:0}};
  
  // keeps track of the index for new pieces & hands
  this.next_piece_id = 0;
  this.next_hand_id  = 0;
  
  // background image
  this.background_color        = "#F4EFEE";
  this.background_image        = new Image();
  this.background_image.onload = this.on_background_image_load.bind(this);
  
  // keep track of the last update time and last undo time
  //this._last_undo   = Date.now();
  
  // keep track of whether we're in peak mode
  this.peak_image_index = 0;

  // zoom pan rotate snap variables
  this.z_max        = 400;
  this.z_min        = 6.25;
  this.z_step       = Math.pow(2,0.25);
  this.z_target     = 100;
  this.previous_z   = this.z_target;
  this.r_step       = 45;
  this.r_target     = 0;  // rotation setpoint
  this.previous_r   = this.r_target;
  
  // current values
  this.z   = 0.25*this.z_target; // start this way to zoom fancy initially
  this.vz  = 0;
  this.r   = 0;
  this.vr  = 0;
  
  this.px  = -window.innerWidth*0.13;
  this.py  = 0;
  this.px_target = this.px;
  this.py_target = 0;
  this.previous_px = this.px_target;
  this.previous_py = this.py_target;
  
  this.vpx = 0;
  this.vpy = 0;
  
  this._t_previous_draw = Date.now();
  
  //// Get the avatar paths
  this.avatar_paths     = [];
  this.avatars          = [];
  
  //// EVENTS 
  
  // eliminates text selection on the canvas
  canvas.addEventListener('selectstart', this.event_selectstart .bind(this), false);
  
  // mouse & keyboard events
  canvas.addEventListener('mousedown',   this.event_mousedown  .bind(this), true); 
  canvas.addEventListener('mousemove',   this.event_mousemove  .bind(this), true); 
  canvas.addEventListener('mouseover',   this.event_mouseover  .bind(this), true);
  canvas.addEventListener('mouseout',    this.event_mouseout   .bind(this), true);
  canvas.addEventListener('mouseup',     this.event_mouseup    .bind(this), true); 
  canvas.addEventListener('dblclick',    this.event_dblclick   .bind(this), true); 
  canvas.addEventListener('mousewheel',  this.event_mousewheel .bind(this), true);
  canvas.addEventListener('contextmenu', this.event_contextmenu.bind(this), true);
  canvas.addEventListener('keydown',     this.event_keydown    .bind(this), true);
  canvas.addEventListener('keyup',       this.event_keyup      .bind(this), true);
  
  //// TIMER that does not require the "go" command to commence.
  setInterval(this.draw.bind(this), draw_interval_ms);
  
  //// COOKIE STUFF
  this.cookie_expire_days = 28;
}

BOARD.prototype.add_avatars = function() {
  my_socket.emit('avatars?');
}

BOARD.prototype.go = function() {
  
  // load cookies
  console.log('go(): load_cookies');
  this.load_cookies();

  // Ready for packets!
  console.log('go(): _ready_for_packets=true');
  this._ready_for_packets = true;

  // Ask for latest piece info
  console.log('go(): emit("?")');
  my_socket.emit('?');

  // Start the timers
  setInterval(this.send_stream_update.bind(this), stream_interval_ms);
}

// cookie stuff
BOARD.prototype.set_cookie = function(key, value) {
  
  // get the expiration date
  var d = new Date();
  d.setTime(d.getTime() + (this.cookie_expire_days*24*60*60*1000));
  
  // now write the cookie string
  document.cookie = this.game_name+"_"+key + '=' + value + '; expires=' + d.toUTCString() + '; SameSite=Lax';
  
  // print the cookie
  //console.log(document.cookie);
}


BOARD.prototype.load_cookies = function() {
  
  // get a list of the cookie elements
  var cs = document.cookie.split(';');

  // loop over the elements
  for(var i=0; i<cs.length; i++) {
    
    // split by "=" sign
    s = cs[i].split('=');

    // strip white space
    while (s[0].charAt(0)==' ') s[0] = s[0].substring(1);
        
    // take action
    send_user_info = false;
    switch(s[0]) {
      
      case this.game_name+'_name': 
        set_name(s[1]);
        send_user_info = true;
        break;
      
      case this.game_name+'_team': 
        set_team_number(parseInt(s[1]));
        send_user_info = true;
        break;
      
      case this.game_name+'_z_target':
        this.set_zoom(parseInt(s[1]));
        break;
      
      case this.game_name+'_r_target':
        this.set_rotation(parseFloat(s[1])%360, true); // also updates the cookie date
        break;
      
      case this.game_name+'_px_target':
        px = parseFloat(s[1]);
        this.px_target = px;
        this.px        = px;
        this.previous_px = px;
        this.set_cookie('px_target', px); // updates the cookie date
        break;
      
      case this.game_name+'_py_target':
        py = parseFloat(s[1]);
        this.py_target = py;
        this.py        = py;
        this.previous_py = py;
        this.set_cookie('py_target', py); // updates the cookie date
        break;
      
      case this.game_name+'_shortcut_coordinates':
        
        // Parse and generate the new coordinates
        ss        = s[1].split(',');
        new_pants = [];
        for(j=0; j<ss.length/4; j++) {
          x = parseFloat(ss[4*j]);
          y = parseFloat(ss[4*j+1]);
          z = parseFloat(ss[4*j+2]);
          r = parseFloat(ss[4*j+3]);
          
          if(x != undefined && y != undefined && z != undefined && r != undefined)
            new_pants.push([x, y, z, r]);
          else
            console.log('OOPS! _shortcut_coordinates cookie corrupt at j =', 
                j, 'with', ss[4*j], ss[4*j+1], ss[4*j+2], ss[4*j+3]);
        }

        // Update the current coordinates
        this.shortcut_coordinates = new_pants;
        
        // update the cookie date
        this.set_cookie('shortcut_coordinates', this.shortcut_coordinates);
        break;

    } // end of switch
    
    // update server with user info if we're supposed to
    if (send_user_info == true) my_socket.emit('user', get_name(), get_team_number());
  }
}
  
  


// Floaters
BOARD.prototype.add_snap_grid = function(x_left, y_top, width, height, x0, y0, dx1, dy1, dx2, dy2) {
  
  // add the snap grid to the array
  this.snap_grids.push( new SNAPGRID(x_left, y_top, width, height, x0, y0, dx1, dy1, dx2, dy2) );
  
  // return the index
  return this.snap_grids.length-1;
}

BOARD.prototype.add_team = function(name, hand_image_paths, color, manager) {
  console.log('add_team()', name, hand_image_paths, color);

  var color   = or_default(color, '#777777');
  var manager = or_default(manager, false);

  // add team to GUI list
  var teams  = document.getElementById("teams");
  var option = document.createElement("option");
  option.text = name;
  teams.add(option);
  
  // add border color, selected piece list, and team zones
  this.team_colors.push(color);
  this.team_zones.push(null);
  this.team_hand_images.push([]);
  var team = this.team_hand_images.length-1;
  if(manager) this.managers.push(team);

  // loop over the hand image paths and load up the images
  for (var i in hand_image_paths) {

    // Get the path
    path = 'hands/'+hand_image_paths[i];

    // make sure we haven't loaded it already (this.images is a lookup dictionary)
    if( path in this.images ) {
      
      // use the existing image
      this.team_hand_images[team].push(this.images[path]);
    
    // otherwise we need to load it
    } else {
    
      // tell Jack that we're loading it...
      console.log("  loading /images/"+path);

      // create the image object
      I = new Image();
      this.team_hand_images[team].push(I);
      I.src = '/images/'+path;
      
      // store this image for the future
      this.images[path] = I;

    } // end of if path in images else.
  } // end of loop over hand image paths
}


/**
 * Sorts the supplied piece list by id, then pops them all to the top.
 * @param {list} pieces list of pieces to sort, then pop to the top.
 */

BOARD.prototype.sort_and_pop_pieces = function(pieces) {
  
  var my_index = get_my_client_index();
  var pieces   = or_default(pieces, this.client_selected_pieces[my_index]);
  
  // Sort them
  pieces.sort(function(a, b){return a.id-b.id});

  // Loop over them, putting them on top of the stack
  for(n=0; n<pieces.length; n++) {
    i = this.find_piece_index(sps[n].id);
    this.pop_piece(i);
    this.insert_piece(sps[n], this.pieces.length);
  }
}


/**
 * Shuffles the supplied pieces, creating a stack at the current location of the bottom card
 *  @param {list} pieces // list of piece objects
 * 
 *  // Optional
 *  @param {int}   active_image // Set the active image of all pieces
 *  @param {float} r_piece      // Set the rotation (degrees) of the piece (relative to board)
 *  @param {float} r_stack      // Set the rotation (degrees) of the stack
 *  @param {float} offset_x     // Override the default offset x.
 *  @param {float} offset_y     // Override the default offset y.
 */
BOARD.prototype.shuffle_pieces = function(pieces, active_image, r_piece, r_stack, offset_x, offset_y) {

  // Find the index of the bottom card

  // Start with the largest possible index
  var ib = 0;

  // Find highest index
  for(var i in pieces) {
    var x = this.pieces.indexOf(pieces[i]);
    if(x > ib) ib = x;
  }
  bottom_piece = this.pieces[ib];

  if(r_piece == null) r_piece = -this.r_target;
  r_piece = or_default(r_piece, bottom_piece.r_target);

  // Now collect them to those coordinates with a shuffle
  this.collect_pieces(pieces, bottom_piece.x_target, bottom_piece.y_target, 
                      true, active_image, -r_piece, r_stack, offset_x, offset_y, true);
}

// Pauses for the desired time in milliseconds. Must be called as await sleep() from an async function.
// See collect_pieces for an example.
function sleep(t_ms) {
  t_ms = or_default(500);

  return new Promise(resolve => {
    setTimeout(() => {
      resolve('all done!');
    }, t_ms);
  });
}

BOARD.prototype.collect_pieces = async function(pieces,x,y,shuffle,active_image,r_piece,r_stack,offset_x,offset_y,from_top) {

  // Things will move, so let's trigger a redraw to be safe / responsive.
  this.trigger_redraw = true;

  // Defaults
  var r_piece  = or_default(r_piece,  this.collect_r_piece);
  var r_stack  = or_default(r_stack,  this.collect_r_stack);
  var offset_x = or_default(offset_x, null);
  var offset_y = or_default(offset_y, null);
  var active_image = or_default(active_image, null);
  
  // shuffle if we're supposed to
  if(shuffle) {

    // Randomize their order
    shuffle_array(pieces);

    // Animation: randomize rotation and displacement
    for(var n in pieces) { var p = pieces[n];
      
      // Send the piece to the top of the stack in the newly shuffled order.
      //p.send_to_top();

      // x,y,r,angle,disable_snap,immediate
      p.set_target(x + (Math.random()-0.5)*this.shuffle_distance,
                   y + (Math.random()-0.5)*this.shuffle_distance,
                      -(Math.random())*720, null);

      // If we have an active image specified, set it
      if(active_image != null) p.set_active_image(active_image);
    }
    
    // Trigger an update to tell everyone the new locations
    this.send_stream_update();
    await sleep(500);
  } 

  // If we're holding the selected pieces, use the mouse coordinates
  if(this.client_is_holding[get_my_client_index()]) {
    x = this.mouse.x;
    y = this.mouse.y;
  }

  // get the rotated offset step vector
  if(r_stack == null) r_stack = this.r_target;
  if(r_piece == null) r_piece = this.r_target;

  // Collect all selected piece to the specified coordinates
  for(var i in pieces) {
    // Put this piece on top, in order, regardless of from_top
    pieces[i].send_to_top();

    // Get the piece from top or bottom for it's position & offset.
    if(from_top) var p = pieces[pieces.length-i-1];
    else         var p = pieces[i];

    // Get the rotated stack step.
    if(offset_x != null && typeof offset_x !== 'undefined') ox = offset_x;
    else                                                    ox = p.collect_offset_x;
    if(offset_y != null && typeof offset_y !== 'undefined') oy = offset_y;
    else                                                    oy = p.collect_offset_y;
    var d = rotate_vector(ox, oy, -r_stack);
  
    if(from_top) {x = x-d.x; y = y+d.y;}
    else         {x = x+d.x; y = y-d.y;}
    
    //                                     x, y,  r,       angle, disable_snap, immediate
    if(p.rotates_with_canvas) p.set_target(x, y, -r_piece, null,  true,         false);
    else                      p.set_target(x, y, this.r_target-r_piece, null,  true,         false);

    // If we have an active image specified, set it
    if(active_image != null) p.set_active_image(active_image);
  }
}


/**
 * Distributes the supplied pieces in a grid centered at x,y.
 * @param {list} pieces list of pieces to expand.
 * @param {int} number_per_row how many pieces to put in each row; defaults to board.expand_number_per_row.
 * @param {float} x center x-coordinate (defaults to pieces center)
 * @param {float} y center y-coordinate (defaults to pieces center)
 * @param {float} spacing_x spacing in x-direction (defaults to this.expand_spacing_x)
 * @param {float} spacing_y spacing in y-direction (defaults to this.expand_spacing_y)
 * @param {int} active_image optional image index.
 * @param {float} r_piece rotation of the pieces (defaults to this.expand_r)
 */

BOARD.prototype.expand_pieces = function(pieces, number_per_row, x, y, spacing_x, spacing_y, active_image, r_piece, r_stack) {

  // Things will move, so let's trigger a redraw to be safe / responsive.
  this.trigger_redraw = true;

  // Defaults
  var my_index = get_my_client_index();
  var pieces   = or_default(pieces,   this.client_selected_pieces[my_index]);
  var r_piece  = or_default(r_piece,  this.expand_r);
  var active_image   = or_default(active_image, null);
  var spacing_x      = or_default(spacing_x, this.expand_spacing_x); 
  var spacing_y      = or_default(spacing_y, this.expand_spacing_y);
  var number_per_row = or_default(number_per_row, this.expand_number_per_row);
  var c = get_center_of_pieces(pieces);
  var x = or_default(x, c.x);
  var y = or_default(y, c.y);

  // Now do the expansion.

  // Will hold lists of pieces for rows
  rows = [];

  // make a copy to destroy.
  var sps = [...pieces];

  // loop over the selected pieces, splicing rows until it's empty
  while(sps.length > 0) rows.push(sps.splice(0,Math.max(1,number_per_row)));

  // loop over the rows, setting the coordinates
  for(ny in rows) {
    dy = spacing_y*(ny-0.5*rows.length+0.5);
    
    // loop over each piece
    for(nx in rows[ny]) {
      
      // Get the dx and dy
      dx = spacing_x*(nx-0.5*rows[ny].length+0.5);
      
      // Rotate the dx,dy vector
      if(r_stack != undefined) d = rotate_vector(dx,dy,r_stack);
      else                     d = rotate_vector(dx,dy,this.r_target);

      // Push the piece on the top of the stack
      p = rows[ny][nx];
      this.pop_piece(this.pieces.indexOf(p)); // doesn't trigger a resend for higher pieces
      this.insert_piece(p,this.pieces.length);

      // Push to the top of selected pieces
      var n = sps.indexOf(p);
      if(n>=0) sps.splice(n,1);
      sps.push(p);

      // Now set the coordinates x,y,r,angle,disable_snap,immediate
      if(p.rotates_with_canvas) p.set_target(x+d.x,y+d.y,r_piece-this.r_target, null, true, false);
      else                      p.set_target(x+d.x,y+d.y,r_piece              , null, true, false);
      // Set the image
      if(active_image != null) p.active_image = active_image;
    }
  }
}

BOARD.prototype.new_client_hand = function() {
  
  // create the hand
  h = new PIECE(this, 0, [], [], this.new_hand_scale);
  h.t_fade_ms           = this.hand_fade_ms;
  h.zooms_with_canvas   = false;
  h.rotates_with_canvas = true;
  
  // make sure it starts faded.
  h.t_previous_move   = Date.now()-h.t_fade_ms*2;
  
  return h;
}


// add a piece to this.pieces. avatar=True for avatars
BOARD.prototype.add_piece = function(image_paths, private_image_paths, scale) {
  
  // by default, use the same image paths for public and private images
  private_image_paths = or_default(private_image_paths, image_paths);
  
  // Log it
  console.log(this.next_piece_id, this.pieces.length, 'add_piece()', image_paths, private_image_paths);

  // get the unique id for the piece
  id = this.next_piece_id++;

  // create the piece 
  p = new PIECE(board, id, image_paths, private_image_paths, scale);

  // push the specified piece onto the stack
  this.pieces.push(p);
  
  // Store the initial index
  p.previous_n = this.pieces.length-1;

  // add the index to the lookup table
  this.piece_lookup[id] = p;

  return p;
}


// Adds many copies of the same piece, returning the array of pieces.
BOARD.prototype.add_pieces = function(quantity, image_paths, private_image_paths) {
  var pieces = [];
  for(n=0; n<quantity; n++) pieces.push(board.add_piece(image_paths, private_image_paths));
  return pieces;
}

/** 
 * Pops a piece from index n, decrementing the rest
 * so they don't trigger an order change update. THis basically assumes
 * the piece will be re-added to the stack later.
 */
BOARD.prototype.pop_piece = function(n) {
  
  // Remove it
  p = this.pieces.splice(n,1)[0];

  // decrement the piece indices above this
  for(i=n; i<this.pieces.length; i++) 
    if(this.pieces[i]) this.pieces[i].previous_n--;
  
  return p;
}

/**
 * Inserts a piece at index n, optionally incrementing piece.previous_n for the rest
 * so that they don't trigger a change.
 */
BOARD.prototype.insert_piece = function(piece, n) {
  
  if(piece) {
    // Find the bottom index
    n = Math.max(n, this.bottom_index);

    // Insert it
    this.pieces.splice(n,0,piece);

    // Update its internal number
    //piece.previous_n = n;

    // Increment the piece indices above this, so that they don't get updated
    for(i=n+1; i<this.pieces.length; i++) this.pieces[i].previous_n++;
  }
}





/**
 * Find the piece by id, starting from the top (most common location).
 */
BOARD.prototype.find_piece_index = function(id) {
  // find a piece by id
  return board.pieces.lastIndexOf(board.piece_lookup[id]);
}

/**
 * Find the pieces associated with the array of piece ids.
 */
BOARD.prototype.find_piece_indices = function(piece_ids) {
  // find piece indices by id
  pids = [];
  for(n in piece_ids) pids.push(this.find_piece_index(piece_ids[n])); 
  return pids;
}

/**
 * Finds the actual piece object of this id.
 */
BOARD.prototype.find_piece = function(id) {
  return board.piece_lookup[id];
}

/**
 * Finds the list of piece objects from the list of ids.
 */
BOARD.prototype.find_pieces = function(piece_ids) {
  ps = [];
  for(n in piece_ids) ps.push(this.find_piece(piece_ids[n]));
  return ps;
}

BOARD.prototype.find_top_piece_at_location = function(x,y) {
  
  // loop over the list of pieces from top to bottom
  for (var i = this.pieces.length-1; i >= 0; i--) {
    // on success, return the index
    if (this.pieces[i].contains(x,y)) return i;
  }

  // FAIL. NOFRIENDS.
  return -1;
}

/**
 * Find the index of the client holding this piece.
 */
BOARD.prototype.find_holding_client_index = function(piece) {

  // Loop over clients
  for(n in this.client_is_holding) {

    // If the client is holding the selected pieces, search for the supplied piece
    // in their selection.
    if(this.client_is_holding[n] && this.client_selected_pieces[n].includes(piece)) return n;
  }

  // No soup.
  return -1;
}

// Background
BOARD.prototype.on_background_image_load = function() {
  //this.canvas.width  = this.background_image.width;
  //this.canvas.height = this.background_image.height;
}
BOARD.prototype.set_background_image = function(image_path) {
  
  // set the image's path
  this.background_image.src = '/images/'+image_path;
}

// Mouse methods
BOARD.prototype.get_mouse_coordinates = function(e) {
  // Converts a mouse event into mouse coordinates with respect to the unrotated, unzoomed canvas (x,y), 
  // and the rotated unzoomed canvas (xr, yr), and the rotated movement (dxr,dyr)
  // Specifying rotated = true will get coordinates with respect to the rotated, unzoomed canvas.

  // figure out the center of the board
  var cx = Math.round(this.canvas.width  / 2);
  var cy = Math.round(this.canvas.height / 2);

  // set the new zoom/rotation/pan
  var sin_r = sin(this.r);
  var cos_r = cos(this.r);
  
  // zoom and pan
  
  // raw coordinates
  xr = (e.offsetX-cx-this.px)/(this.z*0.01);
  yr = (e.offsetY-cy-this.py)/(this.z*0.01);

  // Raw movement
  dxr = (e.movementX)/(this.z*0.01);
  dyr = (e.movementY)/(this.z*0.01);
    
  // return the transformed mouse coordinates
  return {
    x:   cos_r* xr + sin_r* yr,
    y:  -sin_r* xr + cos_r* yr,
    dx:  cos_r*dxr + sin_r*dyr,
    dy: -sin_r*dxr + cos_r*dyr,
    xr: xr,
    yr: yr,
    dxr: dxr,
    dyr: dyr,
    e: e,
  };
}

BOARD.prototype.event_contextmenu = function(e) { 
  // fixes a text-selecting problem with mouse dragging
  
  // prevents the default behavior
  e.preventDefault(); 
}

BOARD.prototype.event_selectstart = function(e) { 
  // fixes a text-selecting problem with mouse dragging
  
  // prevents the default behavior
  e.preventDefault(); 
}

// Find out if the coordinates x,y are in someone else's team zone
BOARD.prototype.in_team_zone = function(x,y) {
  
  for(n=0; n<this.team_zones.length; n++){
    
    // If this is not our team zone and we're in it
    if(this.team_zones[n] != null 
      && this.team_zones[n].contains(x, y))
      // FOUND IT!
      return n;
  }
  // FAIL. NO FRIENDS.
  return -1;
}

/**
 * Searches for the supplied piece in BOARD.client_selected_pieces, returning
 * the client index if found. Returns -1 if not found.
 */
BOARD.prototype.find_selected_client_index = function(piece) {

  // Loop over the selected piece arrays for each team
  for(var i in this.client_selected_pieces) {
    if(this.client_selected_pieces[i].includes(piece)) return i;
  }

  // No soup
  return -1;
}

/**
 * Selects the piece for ourselves. If piece.is_tray, selects all pieces on it as well.
 * @param{PIECE}   piece
 * @param{send_to} where to send it. -1 = bottom, 0 = nowhere, 1 = top.
 */
BOARD.prototype.select_piece = function(piece) {

  //console.log('select_piece', piece.id);

  // Get my index and selected pieces array
  var my_index = get_my_client_index();
  var sps      = this.client_selected_pieces[my_index];
  
  // Don't do anything with the supplied piece if someone else is already 
  // holding it (not just selected, but held!)
  var holder = this.find_holding_client_index(piece);
  if(holder >= 0 && holder != my_index) return;

  // If someone else DID have this selected but ISN'T holding it, remove their selection
  var client2 = this.find_selected_client_index(piece);  
  if(client2 >= 0 && client2 != my_index) this.deselect_piece(piece);

  // Only add it to our selection if we don't already have it.
  var m = sps.indexOf(piece);
  if(m < 0) sps.push(piece);
  
  // If it's a tray, also select all the pieces that are on it.
  if(piece.is_tray) {
      
    // get the index of this piece
    var i0 = this.pieces.lastIndexOf(piece)
  
    // Loop over all pieces above this one, recursively selecting if on top of this piece
    for(var n=i0+1; n<this.pieces.length; n++) {
      p = this.pieces[n];
      
      // If this piece is "on" the original, select it
      // TO DO: This is inefficient, double checking many pieces, but only with trays on trays, I suppose...
      if(piece.contains(p.x, p.y)) this.select_piece(p); 

    } // End of recursive loop
  } // End of "is tray"
}

/**
 * Deselects the specified piece from anyone holding it.
 */
BOARD.prototype.deselect_piece = function(piece) {
  
  //console.log('deselect_piece', piece.id);

  // Find the client index of the piece
  client_index = this.find_selected_client_index(piece);
  
  // Nothing to deselect
  if(client_index < 0) return;

  // Find the piece in the client's array
  var i = this.client_selected_pieces[client_index].indexOf(piece);
  if(i < 0) console.log('OOPS! deselect_piece failed!');
  else {
    // Pop the piece out of our selection.
    this.client_selected_pieces[client_index].splice(i,1); 
  }
}

/**
 * Deselects the supplied list (or all pieces if none supplied)
 */
BOARD.prototype.deselect_pieces = function(pieces) {
  pieces = or_default(pieces, board.pieces);
  for(var n in pieces) this.deselect_piece(pieces[n]);
}

// whenever someone clicks the mouse
BOARD.prototype.event_mousedown = function(e) {
  
  // Get my client list index
  var my_index = get_my_client_index();

  // trigger redraw to be safe
  this.trigger_redraw = true;

  // get the mouse coordinates & team
  this.mouse_down  = this.get_mouse_coordinates(e); // the anchor.
  this.mouse       = this.get_mouse_coordinates(e);
  this.mouse_event = e;
  var team         = get_team_number();
  
  // report the coordinates
  console.log("event_mousedown", this.mouse);

  // Bail if we don't have mouse 0 or 2 (left and right clicks).
  if(e.button != 0 && e.button != 2 || e.ctrlKey) {
    after_event_mousedown(e, this.mouse);
    return;
  }

  // If we're not in someone else's team zone, see if we have clicked on a piece.
  
  // Figure out the team zone we clicked in.
  var team_zone = this.in_team_zone(this.mouse.x, this.mouse.y)
  
  // Our team zone or no team zone or team zone with grab enabled
  if(team_zone == team || team_zone < 0 || this.team_zones[team_zone].grab_mode == 1 || this.managers.includes(team)) {
    
    // loop over ALL pieces from top to bottom
    for (var i=this.pieces.length-1; i>=0; i--) {
      
      // handle on the piece
      var p = this.pieces[i];

      // See if the mouse down happened within the piece and is movable.
      // This if statement returns from the function (quits the loop!)
      if (p.contains(this.mouse.x, this.mouse.y) && 
         (p.movable_by == null ||
          p.movable_by.indexOf(team)>=0)) {
             
          // Find out where to send it
          if      (e.button == 0) var send_to = 1;
          else if (e.button == 2) var send_to = -1;
          else                    var send_to = 0;  // No longer reached due to after_mousedown code above.
          
          // get the piece index (will be -1 if we don't have it already)
          var client_piece_index = this.client_selected_pieces[my_index].indexOf(p);
          
          // If we're holding shift, toggle the selection.
          if(e.shiftKey) {
            
            // If it's not selected, select it
            if(client_piece_index < 0) {
              this.select_piece(p);
              sort_pieces_by_position(this.client_selected_pieces[my_index]);
            }

            // Otherwise, deselect it and don't bother with the popping / holding stuff.
            else {
              this.deselect_piece(p); // remains sorted
              this.client_is_holding[my_index] = false;
              this.trigger_h_stream = true;
            }

            // all done for now
            after_event_mousedown(e, this.mouse);
            return;
          } // Done with shift key toggling

          // Otherwise (no shift key), if we don't have it already, 
          // deselect everything else
          else if(client_piece_index < 0) this.client_selected_pieces[my_index].length = 0;

          // Select this piece (no need to sort, since only one piece now)
          this.select_piece(p);

          // At this point we have selected something with a non-toggle click or clicked
          // on an existing set of selected pieces.
          var sps = this.client_selected_pieces[my_index];

          // Sort them
          sort_pieces_by_position(sps);

          // If we're sending to the top or bottom
          if     (send_to > 0) for(var n in sps)                  sps[n].send_to_top(); 
          else if(send_to < 0) for(var n=sps.length-1; n>=0; n--) sps[n].send_to_bottom();
          
          // Let's treat them as held until the mouseup happens
          this.client_is_holding[my_index] = true;
          this.trigger_h_stream            = true;

          // Also stop the movement and remember the initial coordinates
          for(var j in this.client_selected_pieces[my_index]) {
            var sp = this.client_selected_pieces[my_index][j];
            sp.x_target = sp.x;
            sp.y_target = sp.y;
          }

          // Quit out of the whole function
          after_event_mousedown(e, this.mouse);
          return;
      } // end of mouse click near movable piece
    } // end of loop over all pieces
  } // end of "our team zone or no team zone"

  // If we got this far, it means we clicked somewhere without a valid piece.
  // If there was an object selected, we deselect it & drop whatever we were holding.
  if(!e.ctrlKey && !e.shiftKey) {
    this.client_selected_pieces[my_index].length = 0;  
    this.client_is_holding[my_index] = false;
    this.trigger_h_stream = true;
  }
  
  // store the drag offset for canvas motion
  this.drag_offset_board_x  = this.mouse.x; // mousedown board coordinates
  this.drag_offset_board_y  = this.mouse.y;
  this.drag_offset_screen_x = e.clientX-this.px; // mousedown screen (pixels) coordinates
  this.drag_offset_screen_y = e.clientY-this.py;

  // if we right-clicked or held shift, start the selection box
  // We use the current value of r, which should be updated whenever we move and draw the canvas.
  if(e.shiftKey || e.button != 0) 
    this.client_selection_boxes[my_index] = {x0: this.mouse.x, y0: this.mouse.y,
                                             x1: this.mouse.x, y1: this.mouse.y,
                                             r : this.r,};
  
  after_event_mousedown(e, this.mouse);
}
function after_event_mousedown(event_data, mouse) {
  console.log("after_event_mousedown(event_data, mouse): feel free to write your own function.");
}

BOARD.prototype.event_mouseover = function(e) {
  document.getElementById('table').focus();
} 

BOARD.prototype.event_mouseout = function(e) {
  
  // Stop the edge-of-screen panning
  this._mouse_pan_x = null;
  this._mouse_pan_y = null;

  // Fire the mouseup event to drop pieces & drags.
  this.event_mouseup(e);
}

// whenever the mouse moves in the canvas
BOARD.prototype.event_mousemove = function(e) { 
  
  // get my information
  var team     = get_team_number();
  var my_index = get_my_client_index(); // my_index = -1 until the server assigns us one.

  // get the new mouse coordinates
  if(e) {
    this._previous_mousemove = this.mouse;
    this.mouse = this.get_mouse_coordinates(e);
    this.mouse_event = e;
  }

  // if we're holding pieces, move them with us
  if(my_index >= 0 && this.client_is_holding[my_index]) { 
    
    // Pieces are moving. Better redraw.
    this.trigger_redraw = true;
  
    // Loop over selected pieces, which are also held
    for(n in this.client_selected_pieces[my_index]) { 
      
      // Get the held piece
      var hp = this.client_selected_pieces[my_index][n];
    
      // If we're allowed to move this piece and it exists
      if(hp.movable_by == null || hp.movable_by.indexOf(get_team_number())>=0) {
          
          // Shift all of the coordinates by the distance the mouse moved
          var dx = this.mouse.x - this._previous_mousemove.x;
          var dy = this.mouse.y - this._previous_mousemove.y;
          hp.x_target += dx;
          hp.x        += dx;
          hp.y_target += dy;
          hp.y        += dy;

      } // End of allowed to move
    } // end of loop over held pieces
  } // end of "if holding pieces"
  
  // If we have a selection box, update that.
  else if(this.client_selection_boxes[my_index]) {

    // Trigger a redraw
    this.trigger_redraw = true;

    // Update the coordinates
    this.client_selection_boxes[my_index].x1 = this.mouse.x;
    this.client_selection_boxes[my_index].y1 = this.mouse.y;

    // Update the selection based on these coordinates
    // Loop over all pieces
    for(n in this.pieces) {
      var p   = this.pieces[n];
      var sps = this.client_selected_pieces[my_index]; // my selected pieces list
      var i   = sps.indexOf(p); // index indicating if it's already selected; will be -1

      // If this piece is not in someone else's team zone
      var in_team_zone = this.in_team_zone(p.x, p.y);

      // Our team zone, no team zone, or team zone with grab enabled
      if(in_team_zone == team || in_team_zone < 0 || this.team_zones[in_team_zone].grab_mode == 1 || this.managers.includes(team)) {
        
        var in_box = is_within_selection_box(p.x, p.y, this.client_selection_boxes[my_index]);

        // If it's within the rectangle and ok to move, select it. 
        if(i < 0  && // not selected
           in_box && // in our selection box
          (p.movable_by == null ||         // movable by everyone
           p.movable_by.indexOf(team)>=0)) // movable by my team 
            this.select_piece(p);

      } // end of "available piece"
    } // End of loop over all pieces

    // Sort the selected pieces to match the order of the board.
    sort_pieces_by_position(sps);

  } // End of if we have a selection box

  // Otherwise, we're dragging the canvas; when the mouse is down, these are not null
  else if(this.drag_offset_screen_x && this.drag_offset_screen_y) {
    
    // update the pan coordinates (immediate=true)
    // Pan is set in screen coordinates, 
    // so setting pan=100 when zoomed in will move the board less than zoomed out.
    // This also triggers a redraw, as one might expect.
    this.set_pan(e.clientX-this.drag_offset_screen_x, e.clientY-this.drag_offset_screen_y, true); 
  } 
} // end of event_mousemove

BOARD.prototype.event_mouseup = function(e) {
  console.log('event_mouseup', e);

  // prevents default
  e.preventDefault();
  
  // trigger redraw to be safe
  this.trigger_redraw = true;

  // get the team index
  team     = get_team_number();
  my_index = get_my_client_index();

  // If we're holding our selected pieces, set the final coordinates to trigger a snap
  if(this.client_is_holding[my_index]) {

    // Loop over our selected pieces
    for(n in this.client_selected_pieces[my_index]) {
      
      // Trigger a snap locally
      this.client_selected_pieces[my_index][n].set_target(); 
    
      // Trigger a snap for everyone else
      this.client_selected_pieces[my_index][n].previous_x = null;
    }

    // remove it from our holding
    this.client_is_holding[my_index] = false;
    this.trigger_h_stream = true;
  }
  
  // null out the drag offset so we know not to carry the canvas around
  this.drag_offset_board_x = null;
  this.drag_offset_board_y = null;
  this.drag_offset_screen_x= null;
  this.drag_offset_screen_y= null;

  // null out the selection box
  this.client_selection_boxes[my_index] = null;

  // Update the others, in particular about the selection box
  my_socket.emit('m', this.mouse.x, this.mouse.y, [], // no held piece ids
                      [], this.r_target, // no held piece coordinates
                      null); // no selection boxes. 
  
  // User event handler
  after_event_mouseup(e);
}

// User function.
function after_event_mouseup(e) {console.log('after_event_mouseup(event_data): feel free to write your own function.');}

BOARD.prototype.event_dblclick = function(e) {
  console.log('event_dblclick');
  
  // prevents default
  e.preventDefault();
    
  // trigger redraw to be safe
  this.trigger_redraw = true;

  // If we're not in someone else's team zone, look for a piece at the mouse location
  var p = null; 
  var i = -1; // defaults = no piece worth double clicking
  team_zone = this.in_team_zone(this.mouse.x, this.mouse.y);
  if(get_team_number() == team_zone || team_zone < 0)
  {
    i = this.find_top_piece_at_location(this.mouse.x, this.mouse.y);
    if(i >= 0) p = this.pieces[i];
  }
  
  // if we found it, run the game script on it
  event_dblclick(e,p,i);
  
}
BOARD.prototype.event_mousewheel = function(e) {
  console.log('event_mousewheel', e.wheelDelta);
  
  // prevents default
  e.preventDefault();

  // Caps lock state
  var caps = e.getModifierState("CapsLock");

  // Limit the number of wheel events per second
  if(!this._last_wheel_t) this._last_wheel_t = Date.now();
  var t = Date.now();
  if(e.shiftKey) limit = 250;
  else           limit = 100;
  if(t-this._last_wheel_t < limit) return;
  this._last_wheel_t = t;
  
  // find our selected pieces
  var my_index = get_my_client_index();
  var sps = this.client_selected_pieces[my_index]; 
    
  // trigger redraw to be safe
  this.trigger_redraw = true;

  // if shift or ctrl is held, rotate canvas or pieces
  if (e.shiftKey || e.ctrlKey) {

    // If we've selected pieces and shift
    if (sps.length > 0) {
        if      (e.wheelDelta < 0) {
          if(this.client_is_holding[my_index]) rotate_pieces(sps, sps[sps.length-1].r_step, false, this.mouse.x, this.mouse.y);
          else                                 rotate_pieces(sps, sps[sps.length-1].r_step, false);
        }
        else if (e.wheelDelta > 0) {
          if(this.client_is_holding[my_index]) rotate_pieces(sps, -sps[sps.length-1].r_step, false, this.mouse.x, this.mouse.y);
          else                                 rotate_pieces(sps, -sps[sps.length-1].r_step, false);
        }
    } 
    
    // Otherwise, rotate the board (i.e., control key or no held pieces)
    else {
      // rotate board
      if     (e.wheelDelta > 0) this.set_rotation(this.r_target-this.r_step, caps);
      else if(e.wheelDelta < 0) this.set_rotation(this.r_target+this.r_step, caps);
    } // end of rotate the board.

  } // End of shift or control keys
  
  // zoom canvas unless modifiers are down
  else {    
    if(e.wheelDelta > 0)      this.zoom_in(caps);    
    else if(e.wheelDelta < 0) this.zoom_out(caps);
  }
  
  // reset the timer
  this._t_previous_draw = Date.now();
}

// When someone lifts a key
BOARD.prototype.event_keyup  = function(e) {
  // trigger redraw to be safe
  this.trigger_redraw = true;
  this._t_previous_draw = Date.now();

  // Caps lock for immediate zoom/pan/rotate
  var caps = e.getModifierState("CapsLock");

  // do the default stuff, but only if the canvas has focus
  if(document.activeElement == document.getElementById('table')) {
    
    // find our selected piece
    var my_index = get_my_client_index();
    var sps = this.client_selected_pieces[my_index]; 
          
    console.log('event_keyup',e.keyCode);
    switch (e.keyCode) {
      case 192: // tilde for unzooming.
      case 70:  // F for focus

      // If we're rotating, make it immediate for vomiting reasons.
      this.set_zoom(this._prefocus_zoom_level,           caps || e.shiftKey);
      this.set_pan(this._prefocus_px, this._prefocus_py, caps || e.shiftKey);
      this.set_rotation(this._prefocus_r,              caps || e.shiftKey);
    
      this._tilde_down = false;
      break;

      case 82: // r for roll / randomize
        
        // When we lift the r key, scramble the pieces, drop them, and unset the t0
        scramble_pieces(sps, this.mouse.x, this.mouse.y, 2);
        this.client_is_holding[my_index] = false;
        this._hadoken_charge_t0 = null;

      break;
    }

    // at this point, we call the user function
    after_event_keyup(e,p);
  } // end of canvas has focus
}

// User function
function after_event_keyup(event_data, piece, piece_index) {
  return;
}


// whenever someone pushes down a keyboard button
BOARD.prototype.event_keydown = function(e) {
  //e.preventDefault();

  // trigger redraw to be safe
  this.trigger_redraw = true;
  this._t_previous_draw = Date.now();

  // Get this client index
  var my_index = get_my_client_index();

  // Caps lock for immediate zoom/pan/rotate
  var caps = e.getModifierState("CapsLock");

  // do the default stuff, but only if the canvas has focus
  if(document.activeElement == document.getElementById('table')) {
    
    // find our selected piece
    sps = this.client_selected_pieces[get_my_client_index()]; 
          
    console.log('event_keydown',e.keyCode);
    switch (e.keyCode) {
      
      // Rotate CW
      case 69: // E
        
        // Rotate pieces in place
        if(e.shiftKey && sps.length) for(var i=0; i<sps.length; i++) sps[i].rotate(sps[i].r_step);

        // Otherwise rotate the view.
        else this.set_rotation(this.r_target+this.r_step, caps);
        break;
      
      // Rotate CCW
      case 81: // Q

        // Rotate pieces in place
        if(e.shiftKey && sps.length) for(var i=0; i<sps.length; i++) sps[i].rotate(-sps[i].r_step);

        // Otherwise, set rotation
        else this.set_rotation(this.r_target-this.r_step, caps);
        break;
      
      // Pan right or rotate CW
      case 68: // D
      case 39: // RIGHT
        // Shift key rotates the view with no pieces selected
        if(e.shiftKey && sps.length == 0) this.set_rotation(this.r_target+this.r_step, caps);
        
        // Shift key with pieces rotates them about the mouse
        else if(e.shiftKey && sps.length > 0) {
          if(this.client_is_holding[my_index]) rotate_pieces(sps, sps[sps.length-1].r_step, false, this.mouse.x, this.mouse.y);
          else                                 rotate_pieces(sps, sps[sps.length-1].r_step, false);
        }  
        // otherwise pan
        else this.set_pan(this.px_target-this.pan_step, this.py_target, caps);
        break;
      
      // Pan left or rotate CCW
      case 65: // A
      case 37: // LEFT
        
        // Shift key rotates the view with no pieces selected
        if(e.shiftKey && sps.length == 0) this.set_rotation(this.r_target-this.r_step, caps);
        
        // Shift key with pieces rotates them about the mouse
        else if(e.shiftKey && sps.length > 0) {
          if(this.client_is_holding[my_index]) rotate_pieces(sps, -sps[sps.length-1].r_step, false, this.mouse.x, this.mouse.y);
          else                                 rotate_pieces(sps, -sps[sps.length-1].r_step, false);
        }

        // otherwise pan
        else this.set_pan(this.px_target+this.pan_step, this.py_target, caps);
        
        break;
      
      case 189: // MINUS
        // zoom out
        this.zoom_out(caps);
        break;
      
      // Zoom in
      case 187: // PLUS
        // zoom in
        this.zoom_in(caps);
        break;
      
      // Pan up or zoom in
      case 87: // W
      case 38: // UP
        // zoom
        if (e.shiftKey) this.zoom_in(caps);
        
        // pan
        else this.set_pan(this.px_target, this.py_target+this.pan_step, caps);
        break;
      
      // Pan down or zoom out
      case 83: // S
      case 40: // DOWN
        // zoom
        if(e.shiftKey) this.zoom_out(caps);
        
        // pan
        else this.set_pan(this.px_target, this.py_target-this.pan_step, caps);
        break;
      
      case 48:  // 0
      case 27:  // ESCAPE
        // return home
        this.set_pan(0,0, caps);
        this.set_rotation(this.r_home, caps);
        break;
      
      case 49: // 1
      case 50: // 2
      case 51: // 3
      case 52: // 4
      case 53: // 5
      case 54: // 6
      case 55: // 7
      case 56: // 8
      case 57: // 9

        // Get the index
        var i = e.keyCode - 49

        // Save the current view
        if(e.ctrlKey || e.shiftKey) {
          ratio = 100.0/this.z_target;
          this.shortcut_coordinates[i] = [this.px*ratio, this.py*ratio, this.z_target, this.r_target];
          this.set_cookie('shortcut_coordinates', this.shortcut_coordinates)
        }

        // Get the coordinates
        else if(this.shortcut_coordinates[i]) {
          c = this.shortcut_coordinates[i];
          var x = c[0];
          var y = c[1];
          var z = c[2];
          var r = c[3];
          var ratio = z/100.0;

          console.log('shortcut', i, x, y, z, r);
          if(!isNaN(x) && !isNaN(x) && !isNaN(x) && !isNaN(x)) {
            this.set_pan(x*ratio,y*ratio, caps);
            this.set_zoom(z, caps);
            this.set_rotation(r, caps);
          }
        }
        break;

      case 32: // SPACE
        
        // By default we cycle the selected piece
        // Cycle the piece images
        if(sps.length>0) {
          for(var i in sps) {
            if(e.shiftKey) sps[i].set_active_image(0);
            else           sps[i].increment_active_image();
          }
        }

        // Otherwise we use the one just under the mouse.
        else {

          // Only do so if we're not in someone else's team zone
          team_zone = this.in_team_zone(this.mouse.x, this.mouse.y);
          if(team_zone < 0 || team_zone == get_team_number()) {
            var i = this.find_top_piece_at_location(this.mouse.x, this.mouse.y);
            if(i >= 0) this.pieces[i].increment_active_image(e.ctrlKey || e.shiftKey);
          }
        }  
      
        break;
    
      case 67: // c for collect
        
        // Collect all the pieces into a stack
        this.collect_pieces(this.client_selected_pieces[my_index], 
          this.mouse.x, this.mouse.y,                   // coordinates of the stack
          e.shiftKey, null,                             // shuffle, active image 
          this.collect_r_piece,  this.collect_r_stack,  // r_piece, r_stack
          null, null,                                   // offset_x, offset_y (default to piece values)
          true);                                        // centers stack wrt the TOP piece
    
        break;

      case 88: // x for xpand

        // If the shift key is held, sort / pop to top first
        if(e.shiftKey) this.sort_and_pop_pieces(this.client_selected_pieces[my_index]);
        
        this.expand_pieces(this.client_selected_pieces[my_index], this.expand_number_per_row, 
                           this.mouse.x, this.mouse.y);
        break;
      
      case 90: // z for zhuffle (or undo)
        
        // ctrl-z for undo.
        if(e.ctrlKey) {
          //if(e.shiftKey) this.redo();
          //else           this.undo();
        }
        
        // Normal z just shuffles in place (disable ctrl-z to avoid reflex "undo")
        else {this.shuffle_pieces(this.client_selected_pieces[my_index]);}
        break;

      case 82: // r for roll / randomize
        
        // Only if we aren't already rolling
        if(this._hadoken_charge_t0 != null) break;

        // If we have selected pieces, use those
        if(this.client_selected_pieces[my_index].length) {
          
          // Until we release the key, collect the pieces to the mouse coordinates
          this.collect_pieces(this.client_selected_pieces[my_index], 
            this.mouse.x, this.mouse.y,                   // coordinates of the stack
            e.shiftKey, null,                             // shuffle, active image 
            this.collect_r_piece,  this.collect_r_stack,  // r_piece, r_stack
            null, null,                                   // offset_x, offset_y (default to piece values)
            true);                                        // centers stack wrt the TOP piece
        
          // Record the time that this started for animation reasons
          this._hadoken_charge_t0 = Date.now();
          
          // For each selected piece, set the "ignore_u_until_ms" so incoming events / rebounds
          // Do not mess with the animation.
          for(var n in this.client_selected_pieces[my_index])
            this.client_selected_pieces[my_index][n].ignore_u_until_ms = Date.now()+post_u_ignore_u_ms;
        }
        
        // Otherwise, scramble the piece under the mouse
        else {

          // Only do so if we're not in someone else's team zone
          team_zone = this.in_team_zone(this.mouse.x, this.mouse.y);
          if(team_zone < 0 || team_zone == get_team_number()) {
            var i = this.find_top_piece_at_location(this.mouse.x, this.mouse.y);
            if(i >= 0) scramble_pieces([this.pieces[i]], this.mouse.x, this.mouse.y, 2);
          }
        }

        break;

      case 192: // tilde for focus
      case 70:  // F for focus
        
        if(this._tilde_down) break;
        this._tilde_down = true;

        // Remember the previous
        this._prefocus_r  = this.r_target;
        this._prefocus_px = this.px_target;
        this._prefocus_py = this.py_target;
        this._prefocus_zoom_level  = this.z_target;

        // If we have selected a piece and hold shift, zoom in on that
        if(sps.length && e.shiftKey) {
          this.set_zoom(this.focus_zoom_level, true);

          var N = sps.length-1;

          // Rotate the view to match the piece
          this.set_rotation(-sps[0].r_target, true);
          
          // Get the pan vector
          var pan = rotate_vector(-sps[N].x_target*(this.z_target*0.01), 
                                  -sps[N].y_target*(this.z_target*0.01),
                                  -board.r_target);
          this.set_pan(pan.x, pan.y, true);
        }

        // otherwise, use the mouse.
        else {
          this.set_zoom(this.focus_zoom_level, caps || e.shiftKey);

          // Get the pan vector
          var pan = rotate_vector(-this.mouse.x*this.z_target*0.01,
                                  -this.mouse.y*this.z_target*0.01,
                                  -board.r_target);
          this.set_pan(pan.x, pan.y, caps || e.shiftKey);
        }
        break;
    }

    // at this point, we call the user function
    after_event_keydown(e,p,i);
  } // end of canvas has focus
}

// User functions
function after_event_keydown(event_data, piece, piece_index) {
  return;  
}


// called when someone double clicks. Feel free to overwrite this!
function event_dblclick(event_data, piece, piece_index) {

  // default behavior: cycle through the piece image
  if(piece != null) piece.increment_active_image();
}


// set the size of the canvas
BOARD.prototype.set_size = function(width, height) {
  // sets the dimensions of the board
  this.canvas.width  = width;
  this.canvas.height = height;
}

// set the zoom level of the board
BOARD.prototype.set_zoom = function(z, immediate) {
  
  // defaults
  immediate = or_default(immediate, false);
  
  // Keep the previous value
  this.previous_z = this.z_target;

  // check the bounds
  if(z > this.z_max) z=this.z_max;
  if(z < this.z_min) z=this.z_min;
  
  // sets the target rotation
  console.log('Setting zoom to', z);
  this.z_target = z;
    
  // if it's immediate, set the current value too
  if(immediate) this.z = this.z_target;
  
  // trigger a redraw
  this.trigger_redraw  = true;
  this._t_previous_draw = Date.now();
  
  // store the setting for next time
  this.set_cookie('z_target', this.z_target);
}


// set the orientation of the board
BOARD.prototype.set_rotation = function(r_deg, immediate) {
  
  // defaults
  immediate = or_default(immediate, false);
  
  // sets the target rotation
  this.previous_r = this.r_target;
  this.r_target = r_deg;
    
  // if it's immediate, set the current value too
  if(immediate) this.r = r_deg;
  
  // If we're holding pieces, rotate them as well
  my_index = get_my_client_index();
  if(this.client_is_holding[my_index] && this.client_selected_pieces[my_index].length) {
    // Do the rotation
    rotate_pieces(this.client_selected_pieces[my_index], -r_deg+this.previous_r, immediate, this.mouse.x, this.mouse.y);
    
    // Trigger the mouse move
    this.event_mousemove(this.mouse_event);
  }
  
  // trigger a redraw
  this.trigger_redraw  = true;
  this._t_previous_draw = Date.now();

  // store the setting for next time
  this.set_cookie('r_target', this.r_target);
}

// zoom in
BOARD.prototype.zoom_in = function(immediate) {
  
  var immediate = or_default(immediate, false);

  // increment
  z0 = this.z_target;
  z1 = this.z_target*this.z_step;
  if(z1 > this.z_max) z1=this.z_max;

  // set the zoom
  this.set_zoom(z1, immediate);
  
  // get the ratio and adjust the pan as well
  ratio = z1/z0;
  this.set_pan(this.px_target*ratio, this.py_target*ratio, immediate);
}

// zoom out
BOARD.prototype.zoom_out = function(immediate) {
  
  var immediate = or_default(immediate, false);

  // decrement
  z0 = this.z_target;
  z1 = this.z_target/this.z_step;
  if(z1 < this.z_min) z1=this.z_min;

  // set the zoom
  this.set_zoom(z1, immediate);
  
  // get the ratio and adjust the pan as well
  ratio = z1/z0;
  this.set_pan(this.px_target*ratio, this.py_target*ratio, immediate);
}

// set the orientation of the board
BOARD.prototype.set_pan = function(px, py, immediate) {
  
  // defaults
  immediate = or_default(immediate, false);
  
  // sets the target rotation
  this.previous_px = this.px_target;
  this.previous_py = this.py_target;
  this.px_target = px;
  this.py_target = py;
    
  // if it's immediate, set the current value too
  if(immediate) {
    this.px = px;
    this.py = py;
  }
  
  // trigger a redraw
  this.trigger_redraw  = true;
  this._t_previous_draw = Date.now();

  this.set_cookie('px_target', px);
  this.set_cookie('py_target', py);
}

// set the team zone polygon
BOARD.prototype.add_team_zone = function(team_index, x1,y1, x2,y2, x3,y3, x4,y4, r, alpha, draw_mode, grab_mode) {

  // create a team zone object
  this.team_zones[team_index] = new TEAMZONE(this, team_index, x1,y1, x2,y2, x3,y3, x4,y4, r, alpha, draw_mode, grab_mode);
}

BOARD.prototype.tantrum = function() {
  
  // loop over all pieces and send them in random directions
  for (n in this.pieces) {
  
    u1 = Math.random();
    u2 = Math.random();
    
    // For random stuff, no reason to use the "fast" cos and sin
    x = Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2)*1000.0
    y = Math.sqrt(-2*Math.log(u1))*Math.sin(2*Math.PI*u2)*1000.0
    r = Math.random()*5000-2500;
    
    p = this.pieces[n];
    p.set_target(p.x_target+x,p.y_target+y,r,null,true);
    
  }
  
  // send a full update
  this.send_full_update();
}

BOARD.prototype.needs_redraw = function() {
  // Determine whether any piece requires a redraw
  
  // if we've automatically triggered a redraw
  if (this.trigger_redraw) return (true);
  
  // see if our z etc is off
  if (this.z  != this.z_target  ||
      this.r  != this.r_target  ||
      this.px != this.px_target ||
      this.py != this.py_target) return true;

  // see if any of the hands need a redraw
  for (var i in this.client_hands) {
    if (this.client_hands[i].needs_redraw()) return true;
  }

  // see if any of the pieces need a redraw
  for (var i=0; i<this.pieces.length; i++) {
    if (this.pieces[i].needs_redraw()) return true
  }
  
  // nothing needs an update
  return (false);
}

BOARD.prototype.draw = function() {
  // Redraw the entire canvas. This is only called if something changes

  // if our state is invalid, redraw and validate!
  // TO DO: Performance boost by
  //        Down-convert all images ahead of time to lower def when zoomed out
  //           Could have a separate lookup table for all images and their
  //           Lower-def counterparts.
  //        Ignore drawing pieces outside the view?
  if (this.needs_redraw()) {
    
    var my_index = get_my_client_index();

    //////////////////////////////////////////////////////////////
    // First we calculate the next step in the camera position
    //////////////////////////////////////////////////////////////

    //// Zoom/pan/rotate dynamics
    var t  = Date.now();
    var dt = t - this._t_previous_draw;
    this._t_previous_draw = t;

    // get the target
    var ztarget  = this.z_target;
    var rtarget  = this.r_target;
    var pxtarget = this.px_target;
    var pytarget = this.py_target;
    
    // calculate the target velocity
    var vztarget  = (ztarget  - this.z) *this.transition_speed;
    var vrtarget  = (rtarget  - this.r) *this.transition_speed;
    var vpxtarget = (pxtarget - this.px)*this.transition_speed;
    var vpytarget = (pytarget - this.py)*this.transition_speed;
    
    // calculate the actual velocity after acceleration
    this.vz  = (vztarget  - this.vz) *this.transition_acceleration;
    this.vr  = (vrtarget  - this.vr) *this.transition_acceleration;
    this.vpx = (vpxtarget - this.vpx)*this.transition_acceleration;
    this.vpy = (vpytarget - this.vpy)*this.transition_acceleration;
    
    // adjust the step size
    var dz  = this.vz  * dt/draw_interval_ms;
    var dr  = this.vr  * dt/draw_interval_ms;
    var dpx = this.vpx * dt/draw_interval_ms;
    var dpy = this.vpy * dt/draw_interval_ms;
    
    // make sure we don't overshoot
    if (Math.abs(dz)  > Math.abs(ztarget -this.z )) dz  = ztarget -this.z;
    if (Math.abs(dr)  > Math.abs(rtarget -this.r )) dr  = rtarget -this.r;
    if (Math.abs(dpx) > Math.abs(pxtarget-this.px)) dpx = pxtarget-this.px;
    if (Math.abs(dpy) > Math.abs(pytarget-this.py)) dpy = pytarget-this.py;
    
    // Calculate the new coordinates
    this.z  = this.z +dz;
    this.r  = this.r +dr; 
    this.px = this.px+dpx;
    this.py = this.py+dpy;
    
    // round to the nearest pixel if we've hit the target
    if ( Math.abs(this.z - ztarget) < this.transition_snap) this.z  = ztarget;
    if ( Math.abs(this.px-pxtarget) < this.transition_snap) this.px = pxtarget;
    if ( Math.abs(this.py-pytarget) < this.transition_snap) this.py = pytarget;
    if ( Math.abs(this.r - rtarget) < this.transition_snap) {
      //this.r_target = this.r_target % 360;
      this.r = this.r_target;
    }
    // Update the selection box r value if we have one
    if(this.client_selection_boxes[my_index]) this.client_selection_boxes[my_index].r = this.r;

    // If the board's pan, rotation, or zoom changed, update the hovering mouse coordinates
    // This moves hands, held pieces, and selection boxes around.
    if((dz || dr || dpx || dpy) && this.mouse_event ) this.event_mousemove(this.mouse_event);
    
    // If the board rotated and we're holding pieces, update their rotations (disabled)
    // This led to more responsive rotations (collections of pieces didn't "breath" when rotating the canvas) 
    // but, because of the immediate nature of this update, moving held pieces snapped to the
    // final location.
    // 
    // Currently the functionality of this command ishandled in board.set_rotation(), 
    // which updates the held piece orientation & targets. Conceptually more simple to think about, 
    // for sure, but it has the weird "breathing" artifact...
    /*if(dr && this.client_is_holding[my_index]) 
      rotate_pieces(this.client_selected_pieces[my_index], -dr, true, this.mouse.x, this.mouse.y);*/ 

    //////////////////////////////////////
    // Now we actually update the canvas
    //////////////////////////////////////
    var context  = this.context;
    var canvas   = this.canvas;
    var pieces   = this.pieces;
    
    // set the size to match the window
    context.canvas.width  = window.innerWidth;
    context.canvas.height = window.innerHeight;
    
    // clears the canvas
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = this.background_color;
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    // figure out the center of the board
    var cx = Math.round(canvas.width  / 2);
    var cy = Math.round(canvas.height / 2);

    // set the new z/r/pan. Since this.r is changing a lot and we're not looping over pieces,
    // don't bother with the "memory" versions of sin and cos
    var sin_r = this.z*0.01*Math.sin(this.r*Math.PI/180.0);
    var cos_r = this.z*0.01*Math.cos(this.r*Math.PI/180.0);
    
    // set the actual transform
    this.context.setTransform(cos_r, sin_r, -sin_r, cos_r, this.px+cx, this.py+cy);
    
    // TO DO: also look up requestAnimationFrame API for faster rendering

    // draw the background image
    if (this.background_image != null) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(this.background_image, 
        -this.background_image.width*0.5, -this.background_image.height*0.5);
      }
    
    // draw the team zones that are supposed to appear below everything
    for (var i = 0; i < this.team_zones.length; i++) {
  
      // If the team zone exists and either is the current team number
      // or is draw_mode 0 (supposed to be on the bottom)
      if (this.team_zones[i] != null 
       && (i == get_team_number() 
       || this.team_zones[i].draw_mode == 0)) 
            this.team_zones[i].draw();
  
    } // end of team zones loop
    
    
    // draw all pieces
    for (var i in pieces) {

      // We can skip the drawing of elements that have moved off the screen:
      //max_radius = 1.5*(pieces[i].w - pieces[i].h)
      //
      // Translate and rotate and zoom the piece coordinates so they're set up for 
      // they're matching the window coordinates
      // x = ...;
      // y = ...;
      /* if (pieces[i].x - max_radius < this.width
       && pieces[i].y - max_radius < this.height 
       && pieces[i].x + max_radius > 0
       && pieces[i].y + max_radius > 0) continue; */
       // Check disabled because piece coordinates are absolute and not related
       // to the window's pan or rotation.
      
      // Draw the piece. This call takes care of finding the piece's next coordinates,
      // translating and rotating the context.
      pieces[i].move_and_draw();
      
      // If this piece is selected by someone, draw the selection box
      // draw selection rectangles around pieces for each client
      for (c in this.client_selected_pieces) {
        
        // get the selected pieces for this team
        var sps = this.client_selected_pieces[c]; 
        var j   = sps.indexOf(pieces[i]);

        // Loop over the selected pieces
        if(j>=0) {
          var sp = sps[j];

          // if the piece is selected, draw the selection border
          if (sp.active_image != null) {
            
            // shift to piece coordinates
            context.translate(sp.x, sp.y);
            context.rotate(sp.r*Math.PI/180.0);
            
            // if we're not allowed to rotate, transform
            if(!sp.rotates_with_canvas) context.rotate(-this.r*Math.PI/180.0);
            
            // draw white background of the border
            context.lineWidth   = this.selected_border_width*100.0/this.z;
            context.strokeStyle = this.team_colors[this.client_teams[c]]+'FF';
            sp.draw_selection();
            
            // draw the border
            context.lineWidth   = this.selected_border_width*50.0/this.z;
            context.strokeStyle = "#FFFFFFAA";
            sp.draw_selection();
            
            // if we're not allowed to rotate, transform
            if(!sp.rotates_with_canvas) context.rotate(this.r*Math.PI/180.0);
            
            // untransform
            context.rotate(-sp.r*Math.PI/180.0);
            context.translate(-sp.x, -sp.y);
          } // end of if piece selected, draw rectangle
        } // end of loop over selected pieces for team
      } // end of loop over team selected pieces
    } // end of piece draw loop

    
    

    // Draw the selection boxes
    for(c in this.client_selection_boxes) {

      // If there is a box
      box = this.client_selection_boxes[c];
      if(box) {

        // Update the corners to match the hand coordinates (smoother!)
        // TO DO: this is one step behind the hands!
        if(c != my_index) {
          box.x1 = this.client_hands[c].x;
          box.y1 = this.client_hands[c].y;
        }
        // calculate the corner coordinates based on the rotation angle.
        corners = get_selection_box_corners(box);

        // set the box style
        context.lineWidth   = 0*this.selected_border_width*50.0/this.z;
        context.strokeStyle = this.team_colors[this.client_teams[c]]+'77';
        context.fillStyle   = this.team_colors[this.client_teams[c]]+'77';
        
        // Actually draw it.
        context.beginPath();
        context.moveTo(corners.x0, corners.y0);
        context.lineTo(corners.x2, corners.y2);
        context.lineTo(corners.x1, corners.y1);
        context.lineTo(corners.x3, corners.y3);
        context.closePath();
        context.fill();
      }
    }

    // Draw hands for each client
    for(var i in this.client_ids) {

      // Get the hand and team index
      var team = this.client_teams[i];

      // The move_and_draw() method below requires only hand.images, hand.private_images, 
      // and the active image index to be set. 

      // Set the hand images based on team index
      this.client_hands[i].images         = this.team_hand_images[team]
      this.client_hands[i].private_images = this.team_hand_images[team]      
      if(this.client_is_holding[i]) this.client_hands[i].active_image = 1;
      else                          this.client_hands[i].active_image = 0;

      // Actually do the drawing
      this.client_hands[i].move_and_draw();

    } // end of hand draw loop 


    // draw the team zones on top of everything
    for (var i = 0; i < this.team_zones.length; i++) {
      // If the team zone exists, is not the current team number
      // and is draw_mode 1 (supposed to be on top)
      if (this.team_zones[i] != null 
       && i != get_team_number() 
       && this.team_zones[i].draw_mode == 1) this.team_zones[i].draw();
    }

    // reset the trigger
    this.trigger_redraw = false;
    
  } // end of needs redraw
}

/*BOARD.prototype.undo = function() {

  // If we have no undos, quit out
  if(this.undos.length == 0) {
    console.log('no undos left!');
    return;
  }
  console.log('undoing', this.undos.length);

  // Clean up all the states that match our current state (should be at most 1)
  while(this.get_piece_datas_string() == this.undos[0]) this.undos.splice(0,1);

  // If we have no undos, quit out
  if(this.undos.length == 0) {
    console.log('no undos left!');
    return;
  }
  
  // Save the current view as a redo
  this.redos.splice(0,0,board.get_piece_datas_string());
  this.redos.length = Math.min(this.max_undos, this.redos.length);

  // simulate an incoming update from the server
  server_update(board.get_piece_datas_from_string(this.undos[0]));
  board.send_full_update();
  board._last_undo = Date.now();
} 

BOARD.prototype.redo = function() {
  
  // If we have no undos, quit out
  if(this.redos.length == 0) {
    console.log('no redos left!');
    return;
  }
  console.log('redoing', this.redos.length);

  // Pop the redo and stick it in the undos to restore the original state
  this.undos.splice(0,0, this.redos.splice(0,1)[0]);
  this.undos.length = Math.min(this.max_undos, this.undos.length);

  // simulate an incoming update from the server
  server_update(board.get_piece_datas_from_string(this.undos[0]));
  this.send_full_update();
  this._last_undo = Date.now();
} 

BOARD.prototype.store_undo = function() {
  
  // Get the current layout and append it to the undos if necessary
  var save = this.get_piece_datas_string();
  
  // If we have no undos yet or the last one is not identical to this one
  if(this.undos.length == 0 || this.undos[0] != save) {
    
    console.log('Storing undo', this.undos.length);

    // Prepend this undo
    this.undos.splice(0,0,save);

    // Strip the end ones off until we're at the right length
    this.undos.length = Math.min(this.max_undos, this.undos.length);

    // reset the timer
    this._last_undo = Date.now();

    // kill the redos because something changed.
    this.redos.length = 0;
  }
} */

/** 
 * Timer: sends quick updates every fraction of a second for things like
 * dragging a piece around, hand movement, etc.
 */
BOARD.prototype.send_stream_update = function() {

  // Don't send stream updates until we receive a response to our first '?'
  if(!this.first_u_received) return;

  // Always trigger a redraw to handle things like slow loading of images
  this.trigger_redraw = true;
  var my_index = get_my_client_index();
  
  // Get client index and team
  var my_index = get_my_client_index();
  var sps = this.client_selected_pieces[my_index];
  
  // Allows one to temporarily highlight some pieces (countdown)
  if(this.clear_selected_after > 0) {
    this.clear_selected_after--;
    if(this.clear_selected_after == 0) this.client_selected_pieces[my_index].length = 0;
  }

  // If we're charging a hadoken, scramble the selected images to simulate "rolling"
  if(this._hadoken_charge_t0 != null && sps.length) 
    for(n=0; n<sps.length; n++) {

      // Changing this image will trigger an update that will ping back, possibly right 
      // after a roll. As such, after we do a "scramble", update the time that we 
      // ignore incoming 'u' events (and trigger our outbound 'u' when ignored)
      sps[n].active_image = rand_int(0,sps[n].images.length-1);
      sps[n].ignore_u_until_ms = Date.now()+post_u_ignore_u_ms;
    }

  // Check if any of the client selections have changed; we affect other clients' selections when 
  // we grab their selected pieces.
  for(var client_index in this.client_selected_pieces) {
    
    // Get this client's selected pieces and id
    var csps      = this.client_selected_pieces[client_index];
    var client_id = this.client_ids[client_index];

    // If the current selection doesn't match the previous
    if(!array_compare(csps, this.client_previous_selected_pieces[client_index])) { 

      console.log('send_stream_update(): Detected a selection change, client_index =', client_index, 
                  ', my_index =', my_index, 
                  'previous =',   this.client_previous_selected_pieces[client_index]);
      
      // Assemble just the selected piece ids
      var csp_ids = [];
      for(var i in csps) csp_ids.push(csps[i].id);  

      // emit the selection changed event
      console.log('Sending_s with', csp_ids.length, 'pieces, client_id =', client_id, ', my_id =', this.client_id, csp_ids);
      my_socket.emit('s', csp_ids, client_id);

      // Remember the change so this doesn't happen again. 
      // Make a copy, not a reference!
      this.client_previous_selected_pieces[client_index] = [...csps]; 
    } // end of selected pieces have changed
  } // end of loop over clients



  // If we've manually triggered an h stream
  if(this.trigger_h_stream) {
    console.log('send_stream_update(): Detected held piece change.');

    // Only do this once.
    this.trigger_h_stream = false;

    // Emit the held piece change event; no need for coordinates here, 
    // just who is holding what, and the place in the stack.
    my_socket.emit('h', this.client_is_holding[my_index]);

  } // end of held pieces have changed



  // update the mouse coordinates (if they're different!)
  if (this.mouse.x  != this.previous_mouse.x || 
      this.mouse.y  != this.previous_mouse.y || 
      this.r_target != this.previous_r) {
    
    // assemble a list of held piece coorindates and rotations
    var sp_coords = [];
    for(n in sps) {  
      var p = sps[n];
      sp_coords.push([p.x_target, p.y_target, p.r_target]);
    }
    
    // Get the selected piece ids
    var sp_ids = [];
    for(var i in sps) sp_ids.push(sps[i].id);  

    // emit the mouse update event, which includes the held piece ids and their target coordinates,
    // So that the hand and pieces move as a unit. 
    console.log('Sending_m:', this.mouse.x, this.mouse.y, sp_ids.length, 'pieces');
    my_socket.emit('m', this.mouse.x, this.mouse.y, sp_ids, sp_coords, this.r_target, 
                    this.client_selection_boxes[my_index]);
  
    // store this info
    this.previous_mouse = this.mouse;
    this.previous_r     = this.r_target;
  } // end of updating mouse coordinates
  


  // MAIN LOOP OVER ALL pieces to see if their coordinates or images have changed
  var changed_pieces = [];
  for (var n=0; n<this.pieces.length; n++) { // For some reason, n became a string with "for n in this.pieces!"
    var p = this.pieces[n];
    
    // See if anything has changed or we have manually triggered a 'u'
    if (p.previous_x != p.x_target ||
        p.previous_y != p.y_target ||
        p.previous_r != p.r_target ||
        p.previous_active_image != p.active_image ||
        p.previous_n != n ||
        p.trigger_u_stream) {
      
      // push the piece data
      changed_pieces.push({
        id: p.id,
        x:  p.x_target,
        y:  p.y_target,
        r:  p.r_target,
        n:  n,
        i:  p.active_image,
      })
      
      // reset the previous values
      p.previous_x = p.x_target;
      p.previous_y = p.y_target;
      p.previous_r = p.r_target;
      p.previous_n = n;
      p.previous_active_image = p.active_image;
      p.trigger_u_stream = false;

    } // end of "if anything has changed" about this piece
  } // end of loop over all pieces
  
  // Otherwise, if we found some pieces in different places, send that
  if (changed_pieces.length > 0) {
    console.log('Sending_u with', changed_pieces.length, 'pieces');
    my_socket.emit('u', changed_pieces);
  }

  // If it's been awhile, store an undo point
  //if(Date.now()-this._last_undo > undo_interval_ms) board.store_undo();

} // end of send_stream_update

BOARD.prototype.get_piece_datas = function() {
  
  // assemble the data.
  var piece_datas = [];

  // loop over all pieces
  for(var n=0; n<this.pieces.length; n++) {
    
    // get the piece object
    p = this.pieces[n];

    // add to all the arrays
    piece_datas.push({
      id: p.id,
      x:  p.x_target,
      y:  p.y_target,
      r:  p.r_target,
      i:  p.active_image,
      n:  n
    })
    
    // reset the previous values
    /*p.previous_x = p.x_target;
    p.previous_y = p.y_target;
    p.previous_r = p.r_target;
    p.previous_n = n;
    p.previous_active_image = p.active_image; JACK */
  }

  return piece_datas;
}

BOARD.prototype.get_piece_datas_string = function() {
  
  // Get all the piece datas
  var pds = this.get_piece_datas();

  // Loop over the piece datas assembling the string.
  var s = '';
  for(var n in pds)
    s = s + '\n' + String(pds[n].id) + ','  + String(pds[n].x) + ','  + String(pds[n].y) + ','  + String(pds[n].r) + ','  + String(pds[n].i) + ','  + String(pds[n].n)
  return s;
}

BOARD.prototype.get_piece_datas_from_string = function(s) {

  // Split it into lines
  var lines = s.split('\n');

  // Loop over the lines to make piece datas.
  var piece_datas = [];
  for(var n in lines) {
    
    // Split by the comma delimiter
    a = lines[n].split(',');
    
    // Assemble the piece datas
    if(a.length > 5) {
      piece_datas.push({
        id: parseInt(a[0]),
        x:  parseFloat(a[1]),
        y:  parseFloat(a[2]),
        r:  parseFloat(a[3]),
        i:  parseInt(a[4]),
        n:  parseInt(a[5]),
      });
    } // End of "if line is valid"
  } // End of loop over lines

  return piece_datas;
}

BOARD.prototype.save = function() {

  // Convert the current configuration into a string.
  var text = this.get_piece_datas_string();

  // Get the filename.
  var filename = get_date_string() + ' ' + this.game_name + '.txt';

  // Create a link element for downloading
  var element = document.createElement('a');
  element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
  element.setAttribute('download', filename);
  element.style.display = 'none';
  document.body.appendChild(element);

  // Click it (download the file).
  element.click();

  // Clean up.
  document.body.removeChild(element);
}

BOARD.prototype.load = function() {
  
  // Create a temporary input element
  input = document.createElement('input');
  input.type = 'file';

  // Code to grab the content of the file.
  input.onchange = e => { 

    // getting a hold of the file reference
    var file = e.target.files[0]; 

    // setting up the reader
    var reader = new FileReader();
    reader.readAsText(file,'UTF-8');

    // here we tell the reader what to do when it's done reading...
    reader.onload = readerEvent => {
        var content = readerEvent.target.result; // this is the content!

        // now update the pieces
        server_update(board.get_piece_datas_from_string(content));
        board.send_full_update();
    }
  }

  // Run it
  input.click();
}

// This will query the server with a '?', which should then return
// all the piece coordinates with a 'u' packet. The 'u' handler will
// then update all the non-held pieces.
BOARD.prototype.get_full_update = function() {
  console.log('Sending_?...')
  my_socket.emit('?');
  return;
}

// This function used to be occasionally called by a timer (if we haven't received 
// a full update in awhile, but now that's handled by each client periodically sending
// a '?' query to get the server state. Now this function is only used when the server
// is first started and doesn't know any piece coordinates, or when we do something
// crazy like tantrum.
BOARD.prototype.send_full_update = function() {
  
  // Get the piece datas
  var piece_datas = this.get_piece_datas();

  console.log('Sending_full update:', piece_datas.length, 'pieces');
  
  my_socket.emit('u', piece_datas, true); // true clears the old values from the server's memory

  // Send the team zones
  for(var n in board.team_zones) 
    if(board.team_zones[n]) 
      my_socket.emit('tz', board.team_zones[n].get_packet());
}



//// COMMUNICATION

// socket object for communication
var my_socket = io();

// Send user and get avatar info 
// response handled by socket code below
my_socket.emit('user', get_name(), get_team_number());

// When the server sends avatars
server_avatar = function(avatar_paths) {
  // server sent a list of avatar paths
  console.log('Received_avatar list:', avatar_paths);
  board.avatar_paths = avatar_paths;

  // Load the avatar pieces
  for(var n in avatar_paths) board.avatars.push(board.add_piece([avatar_paths[n]], undefined, board.new_avatar_scale));

  // Reset the scale
  board.new_piece_scale = 1.0;
}
my_socket.on('avatars', server_avatar);

server_ping = function(x){
  // server sent a "chat"
  console.log('Received_ping:', x);
  ping_x = x;
}
my_socket.on('ping', server_ping);

// functions for handling incoming server messages
server_chat = function(msg){
  // server sent a "chat"
  console.log('Received_chat:', msg);

  // messages div object
  m = $('#messages');

  // look for the tag "messages" in the html and append a <li> object to it
  m.append($('<li>').html(msg));

  // scroll to the bottom of the history
  m.animate({ scrollTop: m.prop("scrollHeight") - m.height() }, 'slow');
}
my_socket.on('chat', server_chat);


// Complete user information from server.
server_users = function(client_ids, client_names, client_teams, client_is_holding, client_selected_piece_ids) {
  
  console.log("Received_users:", client_ids, client_names, client_teams, client_is_holding, client_selected_piece_ids);

  // Clear out the old values
  board.client_ids                      = [];
  board.client_names                    = [];
  board.client_teams                    = [];
  board.client_hands                    = [];
  board.client_is_holding               = [];
  board.client_selected_pieces          = [];
  board.client_previous_selected_pieces = [];
  board.client_selection_boxes          = [];
  
  // Clear out and refill the html showing who is connected.
  html_clients = $('#clients');
  html_clients.empty();
  
  // Loop over the supplied clients
  for (var i in client_ids) {
    console.log(' ', i, client_ids[i], client_names[i], client_teams[i], client_is_holding[i], client_selected_piece_ids[i]);

    // Rebuild all the arrays
    sps = board.find_pieces(client_selected_piece_ids[i]);
    board.client_ids                     .push(client_ids[i]);
    board.client_names                   .push(client_names[i]);
    board.client_teams                   .push(client_teams[i]);
    board.client_hands                   .push(board.new_client_hand());
    board.client_is_holding              .push(client_is_holding[i]);
    board.client_selected_pieces         .push(sps);
    board.client_previous_selected_pieces.push([...sps]);
    board.client_selection_boxes         .push(null);

    // figure out the team name for this client
    team_name = document.getElementById("teams").options[client_teams[i]].text;
    
    // Update the text next to the name to show the team
    html_clients.append($('<li>').html(board.client_names[i]+' ('+team_name+')'));
  }
}
my_socket.on('users', server_users);




/**
 * The server has sent a "mousemove" event for
 *   team:       team number
 *   client_id:  user number
 *   x,y:        mouse position
 *   hp_ids:     held piece id array
 *   hp_coords:  held piece coordinates [dx,dy,r] with dx and dy relative to the mouse.
 *   client_r:   hand rotation
 */
server_mousemove = function(client_id, x, y, hp_ids, hp_coords, client_r, selection_box){
  
  // Board is not ready yet. Call board.go() after pieces are defined to start receiving.
  if(!board._ready_for_packets) return;

  // server has sent a "mouse move"
  //console.log('Received_m:', client_id, x, y, hp_ids, hp_coords, client_r, selection_box);

  // Get the client index whose mouse moved
  client_index = board.client_ids.indexOf(client_id);

  // Set the coordinates of the hand for redrawing.
  if(board.client_hands[client_index]) board.client_hands[client_index].set_target(x, y, -client_r, null, true);

  // update this client's selection_box
  board.client_selection_boxes[client_index] = selection_box;

  // set the locations of this client's held pieces (if any)
  for(j in hp_ids) {
    
    // find the held piece
    hp = board.piece_lookup[hp_ids[j]];
        
    // set its coordinates, disabling snap because it's still held.
    hp.set_target(hp_coords[j][0], hp_coords[j][1], hp_coords[j][2], null, true);

    // set its previous coordinates to the same, so that it doesn't trigger an update
    hp.previous_x = hp_coords[j][0];
    hp.previous_y = hp_coords[j][1];
    hp.previous_r = hp_coords[j][2];
  }
}
my_socket.on('m', server_mousemove);

server_selectionchange = function(piece_ids, client_id){
  
  // Board is not ready yet. Call board.go() after pieces are defined to start receiving.
  if(!board._ready_for_packets) return;
  
  // server sent a selection change
  console.log('Received_s: client_id =', client_id, ', my_id =', board.client_id, ', pieces =', piece_ids);
  
  // Get the client index
  client_index = board.client_ids.indexOf(client_id);

  // update the selection, making a copy array for the previous values
  // so that they're independent.
  sps = board.find_pieces(piece_ids);
  board.client_selected_pieces         [client_index] = sps;
  board.client_previous_selected_pieces[client_index] = [...sps];

  // For each of the sps, make sure they're popped from the other
  // client's selected pieces
  for(var i in sps) {
    sp = sps[i];
    for(var c in board.client_selected_pieces) {
      if(c != client_index)
      {
        // If this client's selected pieces contains sp, pop it.
        var j = board.client_selected_pieces[c].indexOf(sp);        
        if(j >= 0) board.client_selected_pieces[c].splice(j,1);
      } 
    }  // End of loop over clients
  } // End of loop over selected pieces

  // trigger a redraw
  board.trigger_redraw = true;
}
my_socket.on('s', server_selectionchange);

server_heldchange = function(client_id, is_holding) {
  // Board is not ready yet. Call board.go() after pieces are defined to start receiving.
  if(!board._ready_for_packets) return;

  // get the client index
  client_index = board.client_ids.indexOf(client_id);

  // Server sent a change in held pieces
  console.log('Received_h: client id =', client_id, 'client index =', client_index, 'is_holding =', is_holding);
  
  // Don't let the server tell us if we're holding something!
  if(client_index != get_my_client_index()) {
    
    // Update the held piece status
    board.client_is_holding[client_index] = is_holding;

    // Make the hand appear again.
    board.client_hands[client_index].t_previous_move = Date.now();
  }
  
  // trigger a redraw
  board.trigger_redraw = true;
}
my_socket.on('h', server_heldchange);

server_assigned_id = function(id) {
  
  // Server sent us our id
  console.log('Received_id:', id);
  board.client_id = id;
}
my_socket.on('id', server_assigned_id);

// Server sends a full update query
function server_wants_full_update() {
  console.log('Received_fu?');
  board.send_full_update();
}
my_socket.on('fu?', server_wants_full_update);

server_team_zone = function(p) {

  // Update the team_zone.
  board.team_zones[p.team_index].set_zone_parameters(p.x1, p.y1, p.x2, p.y2, p.x3, p.y3, p.x4, p.y4, p.r, p.alpha, p.draw_mode, p.grab_mode, false);

}
my_socket.on('tz', server_team_zone);

// Function to handle when the server sends a piece update ('u')
server_update = function(piece_datas) {
  
  // Get my client index
  var my_index = get_my_client_index();

  // Board is not ready yet. Call board.go() after pieces are defined to start receiving.
  if(!board._ready_for_packets) return;

  // Reset the update timer. Board will only send a full update
  board._last_update = Date.now();
  
  console.log('Received_u:', piece_datas.length, 'pieces');

  // Special case: if we got nothing, send a full update to populate the server.
  if(piece_datas.length == 0) {
    board.send_full_update(); // force it.
    // JACK return; Do not return here because we need to tell send_stream_update when we're ready.
  }

  // Sort the incoming piece datas by the target index (n).
  // This must be monotonically increasing for the methods below to work.
  piece_datas.sort(function(a, b){return a.n-b.n});
  
  // run through the list of ids, find the index in the stack (m) of the pieces by id
  var ps = []; // List of pieces needing an update (all those that are not held by me)
  for(var i in piece_datas) {
    var pd = piece_datas[i];
    
    // find the *current* index in the main stack
    var m = board.find_piece_index(pd.id);
    
    // Remove the actual piece from the main stack, to be re-inserted later.
    // We do this for ALL updating pieces, even those that are held, just to preserve
    // the order
    var p = board.pop_piece(m,true); 

    // If the piece is valid, update its coordinates
    if(p) {
      ps.push(p); // save this as an ordered list, matching piece_datas, for later sorting by position n in stack & re-insertion
      
      // Only make local modifications if the pieces are not currently held by me
      // Note if we try to ignore selected pieces, then things like "board setup" will
      // be annoying ("everyone unselect everything!")
      if(i==0) console.log(board.find_holding_client_index(p) != my_index, 
                           p.ignore_u_until_ms, 
                           Date.now()<p.ignore_u_until_ms)
      if(board.find_holding_client_index(p) != my_index &&

      // Also do not make modifications unless either ignore_u_until_ms is defined
      // or we're still in the ignore window.
         (!p.ignore_u_until_ms || Date.now() > p.ignore_u_until_ms)) { 

        // set the new values
        p.set_target(pd.x, pd.y, pd.r, null, true); // disable snap
        p.active_image = pd.i;
        // There is no p.n, only the index in the stack
        
        // store the new coordinates so we don't re-update the server!
        p.previous_x            = p.x_target;
        p.previous_y            = p.y_target;
        p.previous_r            = p.r_target;
        p.previous_active_image = p.active_image;
      } // end of "not held by me"

      // If we ignored it, mark it for update (we control the truth)
      else p.trigger_u_stream = true;

    } // end of piece exists
  } // end of loop over supplied pieces

  // Loop over the pieces again to insert them into the main stack, which currently 
  // should not contain them. We do this 
  // in separate loops so that pieces removed from random locations and sent to 
  // random locations do not interact. The value of n is the final value in the pieces array.
  for(var i in ps) {
    board.insert_piece(ps[i], piece_datas[i].n, true);
    ps[i].previous_n = board.pieces.indexOf(ps[i]); // Don't want to resend this info next time we check
  }

  // Lets self_stream_update start to actually do stuff, only after we're ready.
  if(!board.first_u_received) board.first_u_received = true;
}
my_socket.on('u', server_update);

// action when we click "send chat"
form_submit = function(){

  // emit a "chat message" event with the value from the text box "m"
  my_socket.emit('chat', "<b>"+get_name()+":</b> "+$('#chat-box').val());

  // clear the text box
  $('#chat-box').val('');

  // false means no error I suppose
  return false;
}
$('form').submit(form_submit);

window.onresize = function(event) {
  board.trigger_redraw = true;
};

//// CONTROL EVENTS
function name_onchange() {
  console.log("New name:", get_name());
  board.set_cookie('name', get_name());
  my_socket.emit('user', get_name(), get_team_number());
}
function team_onchange() {
  console.log("New team:", get_team_number());
  board.set_cookie('team', get_team_number());
  my_socket.emit('user', get_name(), get_team_number());
  board.trigger_redraw = true;
}
function peak_onchange() { board.trigger_redraw = true; }

// create the board
var board = new BOARD(document.getElementById('table'));