var Dialog = require('./dialog') ;
var assert = require('assert') ;
var Emitter = require('events').EventEmitter ;
var util = require('util') ;
var _ = require('lodash') ;
var parser = require('drachtio-sip').parser ;
var debug = require('debug')('drachtio-srf') ;


/**
 * Creates a signaling resource framework instance.
 * @constructor
 * @param {Object} app - drachtio app 
 */
function Srf( app ) {
  assert.equal( typeof app, 'function', 'argument \'app\' was not provided or was not a drachtio app') ;

  if (!(this instanceof Srf)) { return new Srf(app); }

  Emitter.call(this); 

  this._app = app ;
  this.dialogs = {} ;

  app.use( this.dialog() ) ;

}
util.inherits(Srf, Emitter) ;

module.exports = exports = Srf ;

/**
 * drachtio middleware that enables Dialog handling
 * @param  {Object} opts - configuration arguments, if any (currently unused)
 */
Srf.prototype.dialog = function(opts) {
  var self = this ;

  opts = opts || {} ;

  return function(req, res, next) {

    debug('examining %s, dialog id: ', req.method, req.stackDialogId ); 
    debug('current dialogs: ', _.keys( self.dialogs )) ;
    if( req.stackDialogId && req.stackDialogId in self.dialogs) {
      debug('calling dialog handler'); 
      var dialog = self.dialogs[req.stackDialogId] ;
      dialog.handle( req, res, next) ;
      return ;
    }
    next() ;
  } ;
} ;

/**
 * respond to an incoming INVITE message by creating a user-agent server (UAS) dialog
 *   
 * @param  {Request}   req    drachtio Request 
 * @param  {Response}  res    drachtio Response
 * @param  {Srf~uasOptions}    opts   configuration options
 * @param {Srf~dialogCreationCallback} cb      callback that provides the created Dialog
 */
Srf.prototype.createUasDialog = function( req, res, opts, cb ) {
  assert.ok( !!req.msg, 'argument \'req\' must be a drachtio Request') ;
  assert.equal( typeof res.agent, 'object', 'argument \'res\' must be a drachtio Response') ;
  assert.equal( typeof opts, 'object', 'argument \'opts\' must be provided with connection options') ;
  assert.equal( typeof opts.localSdp,'string', 'argument \'opts.localSdp\' was not provided') ;
  assert.equal( typeof cb, 'function', 'a callback function is required'); 

  var self = this ;

  opts.headers = opts.headers || {} ;

  res.send( 200, {
    headers: opts.headers,
    body: opts.localSdp
  }, function(err) {
    if( err ) { return cb(err) ; }

    var dialog = new Dialog(self, 'uas', {req: req, res: res} ) ;
    self.dialogs[res.stackDialogId] = dialog ;
    cb( null, dialog ) ;
  }); 
} ;

/**
 * create a user-agent client (UAC) dialog by generating an INVITE request
 *   
 * @param  {RequestUri}   uri -  request uri to send to 
 * @param  {Srf~uacOptions}   opts   configuration options
 * @param {Srf~dialogCreationCallback} cb      callback that provides the created Dialog
 */
Srf.prototype.createUacDialog = function( uri, opts, cb ) {
  var self = this ;

  if( typeof uri === 'string' ) { opts.uri = uri ;}
  else if( typeof uri === 'object' ) { 
    cb = opts ;
    opts = uri ;
  }
  opts.headers = opts.headers || {} ;

  assert.ok( !!opts.uri, 'uri must be specified' ) ;
  assert.equal( typeof opts.localSdp, 'string', 'argument \'opts.localSdp\' was not provided') ;
  assert.equal( typeof cb, 'function', 'a callback function is required') ;

  var parsed = parser.parseUri( opts.uri ) ;
  if( !parsed ) {
    if( -1 === opts.uri.indexOf('@') ) {
      var address = opts.uri ;
      opts.uri = 'sip:' + (opts.calledNumber ? opts.calledNumber + '@' : '') + address ;
    }
    else {
      opts.uri = 'sip:' + opts.uri ;
    }
  }

  if( opts.callingNumber ) {
    opts.headers.from = 'sip:' + opts.callingNumber + '@localhost' ;
  }

  this._app.request({
      uri: opts.uri,
      method: 'INVITE',
      headers: opts.headers,
      body: opts.localSdp
    },
    function( err, req ){
      if( err ) { return cb(err) ; }
      req.on('response', function(res, ack) {
        if( res.status >= 200 ) {
          ack() ;

          if( 200 === res.status ) {
            var dialog = new Dialog(self, 'uac', {res: res} ) ;
            return cb(null, dialog) ;
          }

          cb({
            status: res.status, 
            reason: res.reason,
            msg: res.msg
          }) ;
        }
      }) ;
    }
  ) ;
} ;
/**
 * This callback provides the response to an api request.
 * @callback Srf~dialogCreationCallback
 * @param {Error} err   error returned on non-success
 * @param {Dialog} dialog Dialog object created on success
 */


Srf.prototype.addDialog = function( dialog ) {
  this.dialogs[dialog.id] = dialog ;
  debug('Srf#addDialog: dialog count is now %d ', _.keys( this.dialogs ).length ) ;
} ;
Srf.prototype.removeDialog = function( dialog ) {
  delete this.dialogs[dialog.id] ;
  debug('Srf#removeDialog: dialog count is now %d', _.keys( this.dialogs ).length ) ;
} ;


/**
 * Arguments provided when creating a UAS dialog
 * @typedef {Object} Srf~uasOptions
 * @property {Object=} headers SIP headers to include on the SIP response to the INVITE
 * @property {string} localSdp the local session description protocol to include in the SIP response
 */

/**
 * Arguments provided when creating a UAC dialog
 * @typedef {Object} Srf~uacOptions
 * @property {Object=} headers SIP headers to include on the SIP INVITE request
 * @property {string} localSdp the local session description protocol to include in the SIP INVITE request
 * @property {RequestUri=} uri request uri to send to 
 */
