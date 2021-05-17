/*
	EXM

	Copyright (c) 2020 - 2021 Cédric Ronvel

	The MIT License (MIT)

	Permission is hereby granted, free of charge, to any person obtaining a copy
	of this software and associated documentation files (the "Software"), to deal
	in the Software without restriction, including without limitation the rights
	to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
	copies of the Software, and to permit persons to whom the Software is
	furnished to do so, subject to the following conditions:

	The above copyright notice and this permission notice shall be included in all
	copies or substantial portions of the Software.

	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
	IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
	FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
	AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
	LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
	OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
	SOFTWARE.
*/

"use strict" ;



function Exm( options = {} ) {
	if ( ! options.ns ) { throw new Error( "EXM: namespace ('ns') is required!" ) ; }

	this.ns = options.ns ;
	this.extensionPath = options.extensionPath || '/ext' ;
	this.suffix = options.suffix || '/extension.js' ;

	this.api = options.api || {} ;
	this.exports = options.exports || {} ;

	this.extensions = new Map() ;
}

module.exports = Exm ;

Exm.prototype.__prototypeUID__ = 'exm/browser/Exm' ;
Exm.prototype.__prototypeVersion__ = '0.5' ;



Exm.registerNs = function( options = {} ) {
	if ( ! options.ns || typeof options.ns !== 'string' ) { throw new Error( "EXM: namespace ('ns' property) is required!" ) ; }
	if ( global.EXM.ns[ options.ns ] ) { throw new Error( "EXM: namespace '" + options.ns + "' is already registered!" ) ; }

	var exm = new Exm( options ) ;
	global.EXM.ns[ options.ns ] = exm ;
	return exm ;
} ;



Exm.prototype.requireExtension = async function( extName ) {
	if ( this.extensions.has( extName ) ) { return this.extensions.get( extName ) ; }

	var module_ ,
		extUid = this.ns + '.' + extName ,
		extModuleDir = this.extensionPath + '/' + extUid ,
		extModulePath = extModuleDir + this.suffix ;

	try {
		console.warn( "Trying EXM extension: " , extModulePath ) ;
		module_ = await import( extModulePath ) ;
	}
	catch ( error ) {
		throw new Error( "Required extension '" + extName + "' not found." ) ;
	}


	if ( ! module_ || typeof module_ !== 'object' ) {
		throw new Error( "EXM: this is not an EXM Extension (not an object)" ) ;
	}

	if ( module_.extension ) {
		// This is an ES6 module extension, the extension instance is exported as 'extension'
		module_ = module_.extension ;
	}
	else {
		// This is not an ES6 module (e.g. a CommonJS module), so import() somewhat failed except for side-effect.
		// And since Extension save itself on the global scope as a workaround, we will use that.
		module_ = global.EXM.extensions[ extUid ] ;
		if ( ! module_ || typeof module_ !== 'object' ) {
			throw new Error( "EXM: this is not an EXM Extension (not an ES6 module extension and not registered)" ) ;
		}
	}

	if ( ( module_.__prototypeUID__ !== 'exm/Extension' && module_.__prototypeUID__ !== 'exm/browser/Extension' ) ) {
		throw new Error( "EXM: this is not an EXM Extension (no prototype UID found)" ) ;
	}

	if ( module_.id !== extName ) {
		throw new Error( "EXM: Extension ID mismatch (wanted '" + extName + "' but got " + module_.id + "'." ) ;
	}

	try {
		await module_.init( this , extModulePath , extModuleDir ) ;
		console.log( "Extension '" + module_.id + "'" + ( module_.version ? " (v" + module_.version + ") " : '' ) + "is loaded." ) ;
	}
	catch ( error ) {
		let error_ = new Error( "EXM: Failed to init extension '" + extName + "': " + error ) ;
		error_.from = error ;
		throw error ;
	}

	this.extensions.set( extName , module_ ) ;
	return module_ ;
} ;



Exm.Extension = function( options = {} ) {
	this.isInit = false ;
	this.id = options.id ;	// this is the id of the extension
	this.ns = options.ns ;	// this is the namespace of the host
	this.uid = options.ns + '.' + options.id ;
	this.version = options.version || null ;
	this.host = null ;	// the host Exm
	this.path = null ;
	this.dirPath = null ;
	this.fromModule = options.module ;
	this.hooks = options.hooks || {} ;
	this.api = options.api || {} ;
	this.exports = options.exports || {} ;
} ;

Exm.Extension.prototype.__prototypeUID__ = 'exm/browser/Extension' ;
Exm.Extension.prototype.__prototypeVersion__ = Exm.prototype.__prototypeVersion__ ;



Exm.registerExtension = Exm.Extension.register = function( options = {} ) {
	if ( ! options.id || typeof options.id !== 'string' ) { throw new Error( "EXM Extension: ID ('id' property) is required!" ) ; }
	if ( ! options.ns || typeof options.ns !== 'string' ) { throw new Error( "EXM Extension: namespace ('ns' property) is required!" ) ; }

	var extension = new Exm.Extension( options ) ;

	if ( global.EXM.extensions[ extension.uid ] ) {
		throw new Error( "EXM Extension: ID '" + extension.id + "' is already registered for namespace '" + extension.ns + "'!" ) ;
	}

	global.EXM.extensions[ extension.uid ] = extension ;
	return extension ;
} ;



Exm.Extension.prototype.init = async function( host , path_ , dirPath ) {
	if ( this.isInit ) { return ; }

	if ( host.ns !== this.ns ) { throw new Error( "EXM Extension's namespace mismatches the Host!" ) ; }
	if ( path_ ) { this.path = path_ ; }
	if ( dirPath ) { this.dirPath = dirPath ; }
	this.host = host ;

	if ( typeof this.hooks.init === 'function' ) { await this.hooks.init() ; }

	this.isInit = true ;
} ;



// Should be done at the end, when the whole file is loaded

// Global storage is necessary
if ( ! global.EXM ) {
	global.EXM = {
		master: null ,
		ns: {} ,
		extensions: {}
	} ;
}

