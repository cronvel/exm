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

const NOT_FOUND = {} ;	// Just a constant



function Exm( options = {} ) {
	this.namespace = options.namespace ;
	this.prefix = this.namespace + '-ext-' ;
	this.rootDir = options.rootDir || process.cwd() ;
	this.localExtensionDir = path.join( this.rootDir , 'extensions' ) ;
	this.userExtensionDir = path.join( os.homedir() , '.local' , 'share' , this.namespace , 'extensions' ) ;

	// /!\ Should be OS-dependent
	this.systemExtensionDir = '/' + path.join( 'usr' , 'share' , this.namespace , 'extensions' ) ;

	this.autoInstall = !! options.autoInstall ;

	this.extensions = new Map() ;
}

module.exports = Exm ;



Exm.prototype.requireExtension = function( extName ) {
	if ( this.extensions.has( extName ) ) { return this.extensions.get( extName ) ; }

	var module_ ,
		extModuleName = this.prefix + extName ;

	// First, try in the local dir
	module_ = this.require( extName , path.join( this.localExtensionDir , 'node_modules' , extModuleName ) ) ;
	if ( module_ !== NOT_FOUND ) { return module_ ; }

	module_ = this.require( extName , path.join( this.userExtensionDir , 'node_modules' , extModuleName ) ) ;
	if ( module_ !== NOT_FOUND ) { return module_ ; }

	module_ = this.require( extName , path.join( this.systemExtensionDir , 'node_modules' , extModuleName ) ) ;
	if ( module_ !== NOT_FOUND ) { return module_ ; }

	throw new Error( "Required extension '" + extName + "' not found, try installing it with the command 'exm install " + extName + "'." ) ;
} ;



Exm.prototype.require = function( extName , extPath ) {
	var module_ ;

	try {
		module_ = require( extPath ) ;
		this.extensions.set( extName , module_ ) ;
		return module_ ;
	}
	catch ( error ) {
		return NOT_FOUND ;
	}
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
	output = await execAsync( command ) ;
	console.log( output ) ;
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

