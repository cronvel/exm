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



const Module = require( 'module' ) ;
const path = require( 'path' ) ;
const os = require( 'os' ) ;
const fs = require( 'fs' ) ;
//const fsKit = require( 'fs-kit' ) ;
const execKit = require( 'exec-kit' ) ;
const Lazyness = require( 'lazyness' ) ;

const EXM_CONFIG_FILENAME = 'exm-config.json' ;
const NOT_FOUND = {} ;	// Just a constant
function noop() {}



function Exm( options = {} ) {
	if ( ! options.ns ) { throw new Error( "EXM: namespace ('ns') is required!" ) ; }

	// Should comes first, .autoRootDir() needs this
	this.fromModule = options.module ;
	// For some obscure reasons, this.fromModule.require() does not work well (also module.require !== require)
	this.require = Module.createRequire( this.fromModule.filename ) ;

	this.ns = options.ns ;
	this.prefix = this.ns + '-ext-' ;
	this.rootDir = options.rootDir || null ;

	this.api = options.api || {} ;
	this.exports = {} ;

	if ( options.exports ) {
		Lazyness.requireProperties( this.require , this.exports , options.exports ) ;
	}

	this.localExtensionDir = null ;
	this.userExtensionDir = null ;
	this.systemExtensionDir = null ;

	this.log =
		! options.log ? noop :
		typeof options.log === 'function' ? options.log :
		console.log ;

	this.extensions = new Map() ;

	this.scope = options.scope || 'local' ;
	this.exmConfig = null ;
	this.exmConfigPath = null ;

	this.autoloading = options.autoloading !== undefined ? !! options.autoloading : true ;
	this.isInit = false ;
}

module.exports = Exm ;

Exm.prototype.__prototypeUID__ = 'exm/Exm' ;
Exm.prototype.__prototypeVersion__ = require( '../package.json' ).version ;

// Export lazyness, it can be very useful for extension optimization
Exm.Lazyness = Lazyness ;
Exm.prototype.setScope = function( scope ) { this.scope = scope ; } ;



Exm.prototype.setRootDir = function( rootDir ) {
	if ( this.isInit ) { throw new Error( "Exm is already init, it's too late to change its rootDir" ) ; }
	this.rootDir = rootDir ;
} ;



Exm.registerNs = function( options = {} ) {
	if ( ! options.ns ) { throw new Error( "EXM: namespace ('ns' property) is required!" ) ; }
	if ( global.EXM.ns[ options.ns ] ) { throw new Error( "EXM: namespace '" + options.ns + "' is already registered!" ) ; }

	var exm = new Exm( options ) ;
	global.EXM.ns[ options.ns ] = exm ;
	if ( ! global.EXM.master ) { global.EXM.master = exm ; }

	return exm ;
} ;



// rootDir: change the rootDir, if it is not known at constructor time
Exm.prototype.init = function( rootDir = null ) {
	if ( this.isInit ) { return ; }
	this.isInit = true ;

	if ( rootDir ) {
		this.rootDir = rootDir ;
	}
	else if ( ! this.rootDir ) {
		this.rootDir = global.EXM.master?.rootDir || this.autoRootDir() ;
	}

	this.localExtensionDir = path.join( this.rootDir , 'extensions' ) ;
	this.userExtensionDir = path.join( os.homedir() , '.local' , 'share' , 'exm' , this.ns , 'extensions' ) ;
	// /!\ Should be OS-dependent
	this.systemExtensionDir = '/' + path.join( 'usr' , 'share' , 'exm' , this.ns , 'extensions' ) ;

	this.requireExmConfig() ;
	if ( this.autoloading && this === global.EXM.master ) { this.loadActiveMasterExtensions() ; }
} ;



Exm.prototype.requireExmConfig = function() {
	var changed = false ;

	this.requireExmConfigAt( path.join( this.localExtensionDir , EXM_CONFIG_FILENAME ) ) ;

	if ( ! this.exmConfig ) {
		this.requireExmConfigAt( path.join( this.userExtensionDir , EXM_CONFIG_FILENAME ) ) ;
	}

	if ( ! this.exmConfig ) {
		this.requireExmConfigAt( path.join( this.systemExtensionDir , EXM_CONFIG_FILENAME ) ) ;
	}

	if ( ! this.exmConfig ) {
		let installDir = this.getWriteExtensionDir() ;
		this.exmConfigPath = path.join( installDir , EXM_CONFIG_FILENAME ) ;
		this.exmConfig = {} ;

		// If we haven't found anything, we need to check if everything else is alright in this directory...
		this.checkDirArch( installDir ) ;
	}

	// Now fix the config
	if ( ! this.exmConfig.extensions ) {
		this.exmConfig.extensions = {} ;
		changed = true ;
	}

	if ( changed ) { this.saveExmConfig() ; }
} ;



Exm.prototype.requireExmConfigAt = function( exmConfigPath ) {
	var config ;

	try {
		this.log( "Trying EXM config: " + exmConfigPath ) ;
		config = require( exmConfigPath ) ;
	}
	catch ( error ) {
		return false ;
	}

	if ( ! config || typeof config !== 'object' ) { return false ; }

	this.exmConfig = config ;
	this.exmConfigPath = exmConfigPath ;

	return true ;
} ;



Exm.prototype.saveExmConfig = function() {
	if ( ! this.isInit ) { this.init() ; }

	try {
		fs.writeFileSync( this.exmConfigPath , JSON.stringify( this.exmConfig , null , '  ' ) ) ;
	}
	catch ( error ) {
		// It may be impossible to save, for example if system-wide config is used and we are not root.
		// We just log it and proceed with the following things.
		this.log( "EXM: can't save exm config to '" + this.exmConfigPath + "'." ) ;
		return ;
	}
} ;



Exm.prototype.requireExtension = function( extName ) {
	if ( ! this.isInit ) { this.init() ; }

	if ( this.extensions.has( extName ) ) { return this.extensions.get( extName ) ; }

	var module_ , error ,
		extModuleName = this.prefix + extName ;

	// First, try in the local dir
	module_ = this.requireExtensionAt( extName , path.join( this.localExtensionDir , 'node_modules' , extModuleName ) ) ;
	if ( module_ !== NOT_FOUND ) { return module_ ; }

	module_ = this.requireExtensionAt( extName , path.join( this.userExtensionDir , 'node_modules' , extModuleName ) ) ;
	if ( module_ !== NOT_FOUND ) { return module_ ; }

	module_ = this.requireExtensionAt( extName , path.join( this.systemExtensionDir , 'node_modules' , extModuleName ) ) ;
	if ( module_ !== NOT_FOUND ) { return module_ ; }

	error = new Error( "Required extension '" + extName + "' not found." ) ;
	error.code = 'notFound' ;
	throw error ;
} ;



Exm.prototype.requireExtensionAt = function( extName , extPath ) {
	var module_ ;

	try {
		this.log( "Trying EXM extension: " + extPath ) ;
		module_ = require( extPath ) ;
	}
	catch ( error ) {
		return NOT_FOUND ;
	}

	if ( module_.__prototypeUID__ !== 'exm/Extension' && module_.__prototypeUID__ !== 'exm/browser/Extension' ) {
		throw new Error( "EXM: this is not an EXM Extension" ) ;
	}

	if ( module_.id !== extName ) {
		throw new Error( "EXM: Extension ID mismatch (wanted '" + extName + "' but got " + module_.id + "'." ) ;
	}

	try {
		module_.init( this , extPath ) ;
		this.log( "Extension '" + module_.id + "' (v" + module_.version + ") is loaded." ) ;
	}
	catch ( error ) {
		let error_ = new Error( "EXM: Failed to init extension '" + extName + "': " + error ) ;
		error_.from = error ;
		throw error ;
	}

	this.extensions.set( extName , module_ ) ;
	return module_ ;
} ;



// Load all active extensions of master's exm config
Exm.prototype.loadActiveMasterExtensions = Exm.loadActiveMasterExtensions = function() {
	if ( ! this.isInit ) { this.init() ; }

	var extConfig ,
		master = global.EXM.master ;

	for ( extConfig of Object.values( master.exmConfig.extensions ) ) {
		if ( ! extConfig.active ) { continue ; }

		if ( global.EXM.ns[ extConfig.ns ] ) {
			// Require the extension for the correct ns
			master.log( "Auto-loading active Extension '" + extConfig.id + "' for namespace '" + extConfig.ns + "'." ) ;
			global.EXM.ns[ extConfig.ns ].requireExtension( extConfig.id ) ;
		}
		else {
			master.log( "Extension '" + extConfig.id + "' require a namespace '" + extConfig.ns + "' which is not registered" ) ;
		}
	}
} ;



Exm.prototype.getWriteExtensionDir = function( scope = this.scope ) {
	return scope === 'user' ? this.userExtensionDir :
		scope === 'system' ? this.systemExtensionDir :
		this.localExtensionDir ;
} ;



Exm.prototype.installExtension = async function( id , active = false , ns = null ) {
	if ( ! this.isInit ) { this.init() ; }

	if ( ns ) {
		let exm = global.EXM.ns[ ns ] ;
		if ( ! exm ) { throw new Error( "EXM Namespace not found: " + ns ) ; }
		return exm.installExtension( id , active ) ;
	}

	var command , output ,
		extModuleName = this.prefix + id ,
		installDir = this.getWriteExtensionDir() ;

	active = !! active ;

	this.checkDirArch( installDir ) ;
	command = "cd " + installDir + " ; npm install " + extModuleName ;
	this.log( "Running: " + command ) ;
	output = ( await execKit.exec( command ) ).toString() ;
	this.log( "Command output: " + output ) ;

	this.exmConfig.extensions[ extModuleName ] = {
		id ,
		active ,
		ns: this.ns ,
		module: extModuleName
	} ;

	this.saveExmConfig() ;
} ;



// Install all modules of master's exm config
Exm.prototype.installMasterModules = Exm.installMasterModules = async function() {
	if ( ! this.isInit ) { this.init() ; }

	var extConfig ,
		master = global.EXM.master ;

	for ( extConfig of Object.values( master.exmConfig.extensions ) ) {
		await master.installExtension( extConfig.id , extConfig.active , extConfig.ns ) ;
	}
} ;



Exm.prototype.listOutdatedExtensions = async function() {
	if ( ! this.isInit ) { this.init() ; }

	var command , output , extensions ,
		installDir = this.getWriteExtensionDir() ;

	command = "cd " + installDir + " ; npm outdate --json" ;
	this.log( command ) ;

	try {
		output = await execKit.exec( command ) ;
		output = output.toString() ;
	}
	catch ( error ) {
		if ( error.code === 1 ) {
			output = error.stdout.toString() ;
		}
		else {
			return {} ;
		}
	}

	try {
		extensions = JSON.parse( output ) ;
	}
	catch ( error ) {
		return {} ;
	}

	return extensions ;
} ;



Exm.prototype.updateExtension = async function() {
	if ( ! this.isInit ) { this.init() ; }

	var command , output ,
		installDir = this.getWriteExtensionDir() ;

	this.checkDirArch( installDir ) ;
	command = "cd " + installDir + " ; npm update" ;
	this.log( command ) ;
	output = ( await execKit.exec( command ) ).toString() ;
	this.log( "output: " + output ) ;
} ;



Exm.prototype.checkDirArch = function( installDir = null ) {
	if ( ! installDir ) { installDir = this.getWriteExtensionDir() ; }

	var packageJsonPath = path.join( installDir , 'package.json' ) ,
		exmJsonPath = path.join( installDir , EXM_CONFIG_FILENAME ) ;

	ensurePath( path.join( installDir , 'node_modules' ) ) ;

	try {
		require( packageJsonPath ) ;
	}
	catch ( error ) {
		fs.writeFileSync( packageJsonPath , '{}' ) ;
	}

	try {
		require( exmJsonPath ) ;
	}
	catch ( error ) {
		fs.writeFileSync( exmJsonPath , '{}' ) ;
	}
} ;



Exm.Extension = function( options = {} ) {
	this.isInit = false ;
	this.id = options.id ;	// this is the id of the extension
	this.ns = options.ns ;	// this is the namespace of the host
	this.uid = options.ns + '.' + options.id ;
	this.version = options.version || null ;
	this.host = null ;	// the host Exm
	this.path = null ;
	this.fromModule = options.module ;
	// For some obscure reasons, this.fromModule.require() does not work well (also module.require !== require)
	this.require = Module.createRequire( this.fromModule.filename ) ;
	this.hooks = options.hooks || {} ;
	this.api = options.api || {} ;
	this.exports = {} ;

	if ( options.exports ) {
		Lazyness.requireProperties( this.require , this.exports , options.exports ) ;
	}
} ;

Exm.Extension.prototype.__prototypeUID__ = 'exm/Extension' ;
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



Exm.Extension.prototype.init = function( host , path_ = null ) {
	if ( this.isInit ) { return ; }

	if ( host.ns !== this.ns ) { throw new Error( "EXM Extension's namespace mismatches the Host!" ) ; }
	if ( path_ ) { this.path = path_ ; }
	this.host = host ;

	if ( ! this.version && this.path ) {
		try {
			this.version = require( path.join( this.path , 'package.json' ) ).version ;
		}
		catch ( error ) {}	// Don't care about any error
	}

	if ( typeof this.hooks.init === 'function' ) { this.hooks.init() ; }

	this.isInit = true ;
} ;



/* Helpers */



Exm.prototype.autoRootDir = function() {
	var parts , index , outOfNodeModuleDir , topLevelNodeModuleDir ;

	//parts = __dirname.split( path.sep ) ;		// Don't work with symlinks (they are resolved, so 'npm link' will bug with that)
	//parts = require.main.path.split( path.sep ) ;	// Things like unit tests will not work with this
	parts = this.fromModule.path.split( path.sep ) ;

	index = parts.indexOf( 'node_modules' ) ;
	if ( index !== -1 ) { parts.slice( 0 , index ) ; }
	outOfNodeModuleDir = parts.join( path.sep ) ;

	topLevelNodeModuleDir = recursiveParentSearch( outOfNodeModuleDir , 'node_modules' ) ;

	return topLevelNodeModuleDir !== null ? path.dirname( topLevelNodeModuleDir ) : outOfNodeModuleDir ;
} ;



// Some filesystem methods derived from fs-kit, but synchronous and simplified
function recursiveParentSearch( leftPart , rightPart ) {
	var searchPath , nextLeftPart ;

	for ( ;; ) {
		searchPath = path.join( leftPart , rightPart ) ;

		try {
			fs.accessSync( searchPath ) ;
			return searchPath ;
		}
		catch ( error ) {
			nextLeftPart = path.dirname( leftPart ) ;
			if ( nextLeftPart === leftPart ) { return null ; }
			leftPart = nextLeftPart ;
		}
	}
}



function ensurePath( directoryPath , mode ) {
	directoryPath = path.resolve( directoryPath ) ;
	if ( mode === undefined ) { mode = 0o777 & ( ~ process.umask() ) ; }
	fs.mkdirSync( directoryPath , { mode , recursive: true } ) ;
}



// Should be done at the end, when the whole file is loaded

// Global storage is necessary, especially because modules can depends on different and duplicated version of Exm
if ( ! global.EXM ) {
	global.EXM = {
		master: null ,
		ns: {} ,
		extensions: {}
	} ;
}

