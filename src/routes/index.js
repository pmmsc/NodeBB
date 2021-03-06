"use strict";

var nconf = require('nconf'),
	path = require('path'),
	winston = require('winston'),
	controllers = require('../controllers'),
	meta = require('../meta'),
	plugins = require('../plugins'),
	express = require('express'),

	accountRoutes = require('./accounts'),

	metaRoutes = require('./meta'),
	apiRoutes = require('./api'),
	adminRoutes = require('./admin'),
	feedRoutes = require('./feeds'),
	pluginRoutes = require('./plugins'),
	authRoutes = require('./authentication'),
	helpers = require('./helpers');

var setupPageRoute = helpers.setupPageRoute;

function mainRoutes(app, middleware, controllers) {
	setupPageRoute(app, '/', middleware, [], controllers.home);

	var loginRegisterMiddleware = [middleware.redirectToAccountIfLoggedIn];

	setupPageRoute(app, '/login', middleware, loginRegisterMiddleware, controllers.login);
	setupPageRoute(app, '/register', middleware, loginRegisterMiddleware, controllers.register);
	setupPageRoute(app, '/compose', middleware, [middleware.authenticate], controllers.compose);
	setupPageRoute(app, '/confirm/:code', middleware, [], controllers.confirmEmail);
	setupPageRoute(app, '/outgoing', middleware, [], controllers.outgoing);
	setupPageRoute(app, '/search/:term?', middleware, [middleware.guestSearchingAllowed], controllers.search.search);
	setupPageRoute(app, '/reset/:code?', middleware, [], controllers.reset);
	setupPageRoute(app, '/tos', middleware, [], controllers.termsOfUse);
}

function topicRoutes(app, middleware, controllers) {
	app.get('/api/topic/teaser/:topic_id', controllers.topics.teaser);

	setupPageRoute(app, '/topic/:topic_id/:slug/:post_index?', middleware, [], controllers.topics.get);
	setupPageRoute(app, '/topic/:topic_id/:slug?', middleware, [], controllers.topics.get);
}

function tagRoutes(app, middleware, controllers) {
	setupPageRoute(app, '/tags/:tag', middleware, [middleware.privateTagListing], controllers.tags.getTag);
	setupPageRoute(app, '/tags', middleware, [middleware.privateTagListing], controllers.tags.getTags);
}

function categoryRoutes(app, middleware, controllers) {
	setupPageRoute(app, '/categories', middleware, [], controllers.categories.list);
	setupPageRoute(app, '/popular/:term?', middleware, [], controllers.popular.get);
	setupPageRoute(app, '/recent', middleware, [], controllers.recent.get);
	setupPageRoute(app, '/unread', middleware, [middleware.authenticate], controllers.unread.get);

	setupPageRoute(app, '/category/:category_id/:slug/:topic_index', middleware, [], controllers.categories.get);
	setupPageRoute(app, '/category/:category_id/:slug?', middleware, [], controllers.categories.get);
}

function userRoutes(app, middleware, controllers) {
	var middlewares = [middleware.checkGlobalPrivacySettings];

	setupPageRoute(app, '/users', middleware, middlewares, controllers.users.getUsersSortedByJoinDate);
	setupPageRoute(app, '/users/online', middleware, middlewares, controllers.users.getOnlineUsers);
	setupPageRoute(app, '/users/sort-posts', middleware, middlewares, controllers.users.getUsersSortedByPosts);
	setupPageRoute(app, '/users/sort-reputation', middleware, middlewares, controllers.users.getUsersSortedByReputation);
	setupPageRoute(app, '/users/search', middleware, middlewares, controllers.users.getUsersForSearch);
	setupPageRoute(app, '/users/map', middleware, middlewares, controllers.users.getMap);
 }


function groupRoutes(app, middleware, controllers) {
	var middlewares = [middleware.checkGlobalPrivacySettings, middleware.exposeGroupName];

	setupPageRoute(app, '/groups', middleware, middlewares, controllers.groups.list);
	setupPageRoute(app, '/groups/:slug', middleware, middlewares, controllers.groups.details);
	setupPageRoute(app, '/groups/:slug/members', middleware, middlewares, controllers.groups.members);
}

module.exports = function(app, middleware) {
	var router = express.Router(),
		pluginRouter = express.Router(),
		authRouter = express.Router(),
		relativePath = nconf.get('relative_path'),
		ensureLoggedIn = require('connect-ensure-login');

	pluginRouter.render = function() {
		app.render.apply(app, arguments);
	};

	// Set-up for hotswapping (when NodeBB reloads)
	pluginRouter.hotswapId = 'plugins';
	authRouter.hotswapId = 'auth';

	app.use(middleware.maintenanceMode);

	app.all(relativePath + '(/api|/api/*?)', middleware.prepareAPI);
	app.all(relativePath + '(/api/admin|/api/admin/*?)', middleware.isAdmin);
	app.all(relativePath + '(/admin|/admin/*?)', ensureLoggedIn.ensureLoggedIn(nconf.get('relative_path') + '/login?local=1'), middleware.applyCSRF, middleware.isAdmin);

	adminRoutes(router, middleware, controllers);
	metaRoutes(router, middleware, controllers);
	apiRoutes(router, middleware, controllers);
	feedRoutes(router, middleware, controllers);
	pluginRoutes(router, middleware, controllers);

	mainRoutes(router, middleware, controllers);
	topicRoutes(router, middleware, controllers);
	tagRoutes(router, middleware, controllers);
	categoryRoutes(router, middleware, controllers);
	accountRoutes(router, middleware, controllers);
	userRoutes(router, middleware, controllers);
	groupRoutes(router, middleware, controllers);

	app.use(relativePath, pluginRouter);
	app.use(relativePath, router);
	app.use(relativePath, authRouter);

	if (process.env.NODE_ENV === 'development') {
		require('./debug')(app, middleware, controllers);
	}

	app.use(function(req, res, next) {
		if (req.user || parseInt(meta.config.privateUploads, 10) !== 1) {
			return next();
		}
		if (req.path.startsWith('/uploads/files')) {
			return res.status(403).json('not-allowed');
		}
		next();
	});

	app.use(relativePath, express.static(path.join(__dirname, '../../', 'public'), {
		maxAge: app.enabled('cache') ? 5184000000 : 0
	}));

	handle404(app, middleware);
	handleErrors(app, middleware);


	// Add plugin routes
	plugins.reloadRoutes();
	authRoutes.reloadRoutes();
};

function handle404(app, middleware) {
	app.use(function(req, res, next) {
		if (plugins.hasListeners('action:meta.override404')) {
			return plugins.fireHook('action:meta.override404', {
				req: req,
				res: res,
				error: {}
			});
		}

		var relativePath = nconf.get('relative_path');
		var	isLanguage = new RegExp('^' + relativePath + '/language/[\\w]{2,}/.*.json'),
			isClientScript = new RegExp('^' + relativePath + '\\/src\\/.+\\.js');

		if (isClientScript.test(req.url)) {
			res.type('text/javascript').status(200).send('');
		} else if (isLanguage.test(req.url)) {
			res.status(200).json({});
		} else if (req.accepts('html')) {
			if (process.env.NODE_ENV === 'development') {
				winston.warn('Route requested but not found: ' + req.url);
			}

			res.status(404);

			if (res.locals.isAPI) {
				return res.json({path: req.path.replace(/^\/api/, ''), title: '[[global:404.title]]'});
			}

			middleware.buildHeader(req, res, function() {
				res.render('404', {path: req.path, title: '[[global:404.title]]'});
			});
		} else {
			res.status(404).type('txt').send('Not found');
		}
	});
}

function handleErrors(app, middleware) {
	app.use(function(err, req, res, next) {
		if (err.code === 'EBADCSRFTOKEN') {
			winston.error(req.path + '\n', err.message);
			return res.sendStatus(403);
		}

		if (parseInt(err.status, 10) === 302 && err.path) {
			return res.locals.isAPI ? res.status(302).json(err.path) : res.redirect(err.path);
		}

		winston.error(req.path + '\n', err.stack);

		res.status(err.status || 500);

		if (res.locals.isAPI) {
			return res.json({path: req.path, error: err.message});
		} else {
			middleware.buildHeader(req, res, function() {
				res.render('500', {path: req.path, error: err.message});
			});
		}
	});
}

