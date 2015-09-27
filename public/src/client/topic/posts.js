'use strict';

/* globals config, app, ajaxify, define, socket, utils */

define('forum/topic/posts', [
	'forum/pagination',
	'forum/infinitescroll',
	'forum/topic/postTools',
	'navigator',
	'components'
], function(pagination, infinitescroll, postTools, navigator, components) {

	var Posts = {};

	Posts.onNewPost = function(data) {
		var tid = ajaxify.data.tid;
		if (data && data.posts && data.posts.length && parseInt(data.posts[0].tid, 10) !== parseInt(tid, 10)) {
			return;
		}

		if (!data || !data.posts || !data.posts.length) {
			return;
		}

		updatePostCounts(data.posts);

		if (config.usePagination) {
			onNewPostPagination(data);
		} else {
			onNewPostInfiniteScroll(data);
		}
	};

	function updatePostCounts(posts) {
		for (var i=0; i<posts.length; ++i) {
			var cmp = components.get('user/postcount', posts[i].uid);
			cmp.html(parseInt(cmp.attr('data-postcount'), 10) + 1);
			utils.addCommasToNumbers(cmp);
		}
	}

	function onNewPostPagination(data) {
		function scrollToPost() {
			scrollToPostIfSelf(data.posts[0]);
		}

		var posts = data.posts;

		pagination.pageCount = Math.max(1, Math.ceil((posts[0].topic.postcount - 1) / config.postsPerPage));
		var direction = config.topicPostSort === 'oldest_to_newest' || config.topicPostSort === 'most_votes' ? 1 : -1;

		var isPostVisible = (pagination.currentPage === pagination.pageCount && direction === 1) || (pagination.currentPage === 1 && direction === -1);

		if (isPostVisible) {
			createNewPosts(data, components.get('post').not('[data-index=0]'), direction, scrollToPost);
		} else if (parseInt(posts[0].uid, 10) === parseInt(app.user.uid, 10)) {
			pagination.loadPage(pagination.pageCount, scrollToPost);
		}
	}

	function onNewPostInfiniteScroll(data) {
		var direction = config.topicPostSort === 'oldest_to_newest' || config.topicPostSort === 'most_votes' ? 1 : -1;

		createNewPosts(data, components.get('post').not('[data-index=0]'), direction, function(html) {
			if (html) {
				html.addClass('new');
			}
			scrollToPostIfSelf(data.posts[0]);
		});
	}

	function scrollToPostIfSelf(post) {
		var isSelfPost = parseInt(post.uid, 10) === parseInt(app.user.uid, 10);
		if (isSelfPost) {
			navigator.scrollBottom(post.index);
		}
	}

	function createNewPosts(data, repliesSelector, direction, callback) {
		callback = callback || function() {};
		if (!data || (data.posts && !data.posts.length)) {
			return callback();
		}

		function removeAlreadyAddedPosts() {
			var newPosts = components.get('topic').find('[data-index][data-index!="0"].new');

			if (newPosts.length === data.posts.length) {
				var allSamePids = true;
				newPosts.each(function(index, el) {
					if (parseInt($(el).attr('data-pid'), 10) !== parseInt(data.posts[index].pid, 10)) {
						allSamePids = false;
					}
				});

				if (allSamePids) {
					newPosts.each(function() {
						$(this).removeClass('new');
					});
					data.posts.length = 0;
					return;
				}
			}

			if (newPosts.length && data.posts.length > 1) {
				data.posts.forEach(function(post) {
					var p = components.get('post', 'pid', post.pid);
					if (p.hasClass('new')) {
						p.remove();
					}
				});
			}

			data.posts = data.posts.filter(function(post) {
				return components.get('post', 'pid', post.pid).length === 0;
			});
		}

		removeAlreadyAddedPosts();

		if (!data.posts.length) {
			return callback();
		}

		var after, before;

		if (direction > 0 && repliesSelector.length) {
			after = repliesSelector.last();
		} else if (direction < 0 && repliesSelector.length) {
			before = repliesSelector.first();
		}

		data.title = $('<div></div>').text(ajaxify.data.title).html();
		data.slug = ajaxify.data.slug;
		data.viewcount = ajaxify.data.viewcount;

		$(window).trigger('action:posts.loading', {posts: data.posts, after: after, before: before});

		infinitescroll.parseAndTranslate('topic', 'posts', data, function(html) {
			if (after) {
				html.insertAfter(after);
			} else if (before) {
				// Save document height and position for future reference (about 5 lines down)
				var height = $(document).height(),
					scrollTop = $(window).scrollTop();

				html.insertBefore(before);

				// Now restore the relative position the user was on prior to new post insertion
				$(window).scrollTop(scrollTop + ($(document).height() - height));
			} else {
				components.get('topic').append(html);
			}

			removeExtraPosts(direction);

			html.hide().fadeIn('slow');

			var pids = [];
			for(var i=0; i<data.posts.length; ++i) {
				pids.push(data.posts[i].pid);
			}

			$(window).trigger('action:posts.loaded', {posts: data.posts});
			onNewPostsLoaded(html, pids);
			callback(html);
		});
	}

	function removeExtraPosts(direction) {
		var posts = components.get('post');
		if (posts.length > 40) {
			var removeCount = posts.length - 40;
			if (direction > 0) {
				var height = $(document).height(),
					scrollTop = $(window).scrollTop();

				posts.slice(0, removeCount).remove();

				$(window).scrollTop(scrollTop + ($(document).height() - height));
			} else {
				posts.slice(posts.length - removeCount).remove();
			}
		}
	}

	function onNewPostsLoaded(html, pids) {
		if (app.user.uid) {
			socket.emit('posts.getPrivileges', pids, function(err, privileges) {
				if(err) {
					return app.alertError(err.message);
				}

				for(var i=0; i<pids.length; ++i) {
					toggleModTools(pids[i], privileges[i]);
				}
			});
		} else {
			for(var i=0; i<pids.length; ++i) {
				toggleModTools(pids[i], {editable: false, move: false});
			}
		}

		Posts.processPage(html);
	}

	function toggleModTools(pid, privileges) {
		var postEl = components.get('post', 'pid', pid),
			isSelfPost = parseInt(postEl.attr('data-uid'), 10) === parseInt(app.user.uid, 10);

		if (!privileges.editable) {
			postEl.find('[component="post/edit"], [component="post/delete"], [component="post/purge"]').remove();
		}

		if (!privileges.move) {
			postEl.find('[component="post/move"]').remove();
		}

		postEl.find('[component="user/chat"], [component="post/flag"]').toggleClass('hidden', isSelfPost || !app.user.uid);
	}

	Posts.loadMorePosts = function(direction) {
		if (!components.get('topic').length || navigator.scrollActive) {
			return;
		}

		var replies = components.get('post').not('[data-index=0]').not('.new');
		var afterEl = direction > 0 ? replies.last() : replies.first();
		var after = parseInt(afterEl.attr('data-index'), 10) || 0;

		var tid = ajaxify.data.tid;
		if (!utils.isNumber(tid) || !utils.isNumber(after) || (direction < 0 && components.get('post', 'index', 0).length)) {
			return;
		}

		var indicatorEl = $('.loading-indicator');
		if (!indicatorEl.is(':animated')) {
			indicatorEl.fadeIn();
		}

		infinitescroll.loadMore('topics.loadMore', {
			tid: tid,
			after: after,
			direction: direction
		}, function (data, done) {

			indicatorEl.fadeOut();

			if (data && data.posts && data.posts.length) {
				createNewPosts(data, components.get('post').not('[data-index=0]').not('.new'), direction, done);
			} else {
				if (app.user.uid) {
					socket.emit('topics.markAsRead', [tid]);
				}
				navigator.update();
				done();
			}
		});
	};

	Posts.processPage = function(posts) {
		app.createUserTooltips();
		app.replaceSelfLinks(posts.find('a'));
		utils.addCommasToNumbers(posts.find('.formatted-number'));
		utils.makeNumbersHumanReadable(posts.find('.human-readable-number'));
		posts.find('.timeago').timeago();
		posts.find('[component="post/content"] img:not(.emoji)').each(function() {
			var $this = $(this);
			if (!$this.parent().is('a')) {
				$this.wrap('<a href="' + $this.attr('src') + '" target="_blank">');
			}
		});
		postTools.updatePostCount();
		addBlockquoteEllipses(posts.find('[component="post/content"] > blockquote'));
		hidePostToolsForDeletedPosts(posts);
		showBottomPostBar();
	};

	function showBottomPostBar() {
		if(components.get('post').length > 1 || !components.get('post', 'index', 0).length) {
			$('.bottom-post-bar').removeClass('hidden');
		}
	}

	function hidePostToolsForDeletedPosts(posts) {
		posts.each(function() {
			if ($(this).hasClass('deleted')) {
				postTools.toggle($(this).attr('data-pid'), true);
			}
		});
	}

	function addBlockquoteEllipses(blockquotes) {
		blockquotes.each(function() {
			var $this = $(this);
			if ($this.find(':hidden:not(br)').length && !$this.find('.toggle').length) {
				$this.append('<i class="fa fa-angle-down pointer toggle"></i>');
			}
		});
	}

	return Posts;

});