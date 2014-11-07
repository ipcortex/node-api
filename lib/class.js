/**

 // START OF DOCUMENTATION.

 // Define a new "Class Type" to make OO a little simpler.

 Example:
 ========

 // Declare "Thing" to be a base class, and provide its definition.

 var Thing = new Class({
	// Class global variable(s) - Any object, cannot be a string.
	classData: {m_var: "Class Variable"},

	// Class Constructor...
	construct: function(name) {
		// Initialise instance variables, careful of namespace clashes.
		this.attrs = {name: name};
		.
		.
		.
	},

	// Member functions...
	set: function(name, val) {
		.
		.
		.
	},
});

 // Extend "Thing" in order to define "SpecificThing".

 var SpecificThing = Thing.extend({
	construct: function(name) {
		Thing.construct.call(this, name);	// Call parent constructor
		this.attrs.name2 = "Special: "+name;
	},

	// Optionally override functions...
	set: function(name, val) {
		.
		.
		.
		Thing.set.call(this, name, val);	// Call parent implementation
	},

	// Extended object functions...
	getAll: function() {
		.
		.
		.
	}
});

 // To create a class with truly static/private variables/functions, the following form works:

 var PrivateThing = (function() {
	var	 privateVariable = "...";
	function privateFunction() { ... };

	// Then one of the following as required.
	return new Class({ ...class def... });
	return Thing.extend({ ...class extend... });
})();

 // Create instances...

 var country = Thing.create("England");
 var nation  = SpecificThing.create("UK");

 // Or...

 var country = new Thing("England");
 var nation  = new SpecificThing("UK");

 // END OF DOCUMENTATION.

 **/

(function () {
	/** Constructor for a 'Class' object **/

	var Class = function(def) {
		var result;
		if( typeof def.construct == 'function' )
			result = def.construct;
		else
			def.construct = result = function() {};
		_forEachIn(Class.prototype, function(name, value) {
			result[name] = value;
		});
		_forEachIn(def, function(name, value) {
			result.prototype[name] = value;
			if( typeof result[name] != 'function' )
				result[name] = value;
		});
		return result;
	};

	/** Private methods **/

	var _forEachIn = function(object, action) {
		for (var property in object) {
			if (object.hasOwnProperty(property))
				action(property, object[property]);
		}
	};

	Class.prototype._isClass = true;

	/** Class management methods **/
	Class.prototype.create = function() {
		var o = function() {};
		o.prototype = this.prototype;
		o.prototype.construct = this;
		var t = new o();
		if (typeof t.construct == "function")
			t.construct.apply(t, arguments);
		delete t.construct;
		return t;
	};

	Class.prototype.extend = function(def) {
		var result;
		var _this = this;
		if( typeof def.construct == 'function' ) {
			result = def.construct;
		} else
			def.construct = result = function() {_this.construct.apply(this, arguments)};
		_forEachIn(Class.prototype, function(name, value) {
			result[name] = value;
		});
		_forEachIn(this.prototype, function(name, value) {
			result.prototype[name] = value;
			if( typeof value != 'function' && typeof result[name] != 'function' )
				result[name] = value;
		});
		_forEachIn(def, function(name, value) {
			result.prototype[name] = value;
			if( typeof result[name] != 'function' )
				result[name] = value;
		});
		return result;
	};

	module.exports = Class;

})();