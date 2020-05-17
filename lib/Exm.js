/*
	EXM

	Copyright (c) 2020 Cédric Ronvel

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



const path = require( 'path' ) ;
const os = require( 'os' ) ;
const fs = require( 'fs' ) ;
const fsKit = require( 'fs-kit' ) ;

const Promise = require( 'seventh' ) ;
Promise.promisifyNodeApi( require( 'child_process' ) ) ;
const execAsync = require( 'child_process' ).execAsync ;

const lazy = require( 'lazyness' ) ;

const NOT_FOUND = {} ;	// Just a constant



function Exm( options = {} ) {
	if ( ! options.ns ) { throw new Error( "EXM: namespace ('ns') is required!" ) ; }

	this.ns = options.ns ;
	this.prefix = this.ns + '-ext-' ;
	this.rootDir = options.rootDir || process.cwd() ;
	
	// Useful? use this.require() instead
	//this.hostDir = options.hostDir || options.rootDir ;
	this.require = options.require ;
	this.exports = options.exports || {} ;

	this.localExtensionDir = path.join( this.rootDir , 'extensions' ) ;
	this.userExtensionDir = path.join( os.homedir() , '.local' , 'share' , this.ns , 'extensions' ) ;

	// /!\ Should be OS-dependent
	this.systemExtensionDir = '/' + path.join( 'usr' , 'share' , this.ns , 'extensions' ) ;

	this.autoInstall = !! options.autoInstall ;

	this.extensions = new Map() ;
}

module.exports = Exm ;

Exm.prototype.__prototypeUID__ = 'exm/Exm' ;
Exm.prototype.__prototypeVersion__ = require( '../package.json' ).version ;



Exm.ns = {} ;
Exm.registerNs = function( options = {} ) {
	if ( ! options.ns ) { throw new Error( "EXM: namespace ('ns' property) is required!" ) ; }
	if ( Exm.ns[ options.ns ] ) { throw new Error( "EXM: namespace '" + options.ns + "' is already registered!" ) ; }

	var exm = new Exm( options ) ;
	Exm.ns[ options.ns ] = exm ;
	return exm ;
} ;



Exm.prototype.require = function( extName ) {
	if ( this.extensions.has( extName ) ) { return this.extensions.get( extName ) ; }

	var module_ , error ,
		extModuleName = this.prefix + extName ;

	// First, try in the local dir
	module_ = this.requireAt( extName , path.join( this.localExtensionDir , 'node_modules' , extModuleName ) ) ;
	if ( module_ !== NOT_FOUND ) { return module_ ; }

	module_ = this.requireAt( extName , path.join( this.userExtensionDir , 'node_modules' , extModuleName ) ) ;
	if ( module_ !== NOT_FOUND ) { return module_ ; }

	module_ = this.requireAt( extName , path.join( this.systemExtensionDir , 'node_modules' , extModuleName ) ) ;
	if ( module_ !== NOT_FOUND ) { return module_ ; }

	error = new Error( "Required extension '" + extName + "' not found, try installing it with the command 'exm install " + extName + "'." ) ;
	error.code = 'notFound' ;
	throw error ;
} ;



Exm.prototype.requireAt = function( extName , extPath ) {
	var module_ , hostObject ;

	try {
		console.log( "Trying" , extPath ) ;
		module_ = require( extPath ) ;
	}
	catch ( error ) {
		return NOT_FOUND ;
	}

	if ( module_.__prototypeUID__ !== 'exm/Extension' ) {
		throw new Error( "EXM: this is not an EXM Extension" ) ;
	}

	module_.init( this ) ;

	this.extensions.set( extName , module_ ) ;
	return module_ ;
} ;



Exm.prototype.install = async function( extName , mode = 'local' ) {
	var command , output ,
		extModuleName = this.prefix + extName ,
		installDir =
			mode === 'user' ? this.userExtensionDir :
			mode === 'system' ? this.systemExtensionDir :
			this.localExtensionDir ;

	await this.checkDirArch( installDir ) ;
	command = "cd " + installDir + " ; npm install " + extModuleName ;
	console.log( command ) ;
	output = ( await execAsync( command ) ).toString() ;
	console.log( "output:" , output ) ;
} ;



Exm.prototype.checkDirArch = async function( installDir ) {
	var packageJsonPath = path.join( installDir , 'package.json' ) ;

	await fsKit.ensurePath( path.join( installDir , 'node_modules' ) ) ;

	try {
		require( packageJsonPath ) ;
	}
	catch ( error ) {
		await fs.promises.writeFile( packageJsonPath , '{}' ) ;
	}
} ;



Exm.Extension = function( options = {} ) {
	this.isInit = false ;
	this.host = null ;	// the host Exm
	this.require = options.require ;
	this.exports = {} ;
	
	if ( options.exports ) {
		lazy.requireProperties( this.exports , options.exports ) ;
	}
} ;

Exm.Extension.prototype.__prototypeUID__ = 'exm/Extension' ;
Exm.Extension.prototype.__prototypeVersion__ = require( '../package.json' ).version ;



Exm.Extension.prototype.init = function( host ) {
	if ( this.isInit ) { return ; }
	console.log( "Extension loaded" , host ) ;
	this.isInit = true ;
	this.host = host ;

	if ( typeof this.hooks.init === 'function' ) { this.hooks.init() ; }
} ;

