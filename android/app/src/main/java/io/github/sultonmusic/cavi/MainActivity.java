package io.github.sultonmusic.cavi;

import android.app.SearchManager;
import android.content.Intent;
import android.net.Uri;
import android.provider.MediaStore;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

/**
 * Opens the site full screen. "Hey Google, play … on Cavi Music" arrives as MEDIA_PLAY_FROM_SEARCH:
 * the request goes to the site as ?play=… and the DJ there finds and plays it (empty = play something).
 */
public class MainActivity extends LauncherActivity {
    @Override
    protected Uri getLaunchingUrl() {
        Intent intent = getIntent();
        if (intent == null || !MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH.equals(intent.getAction())) {
            return super.getLaunchingUrl();
        }
        String query = clean(intent.getStringExtra(SearchManager.QUERY));
        String title = clean(intent.getStringExtra(MediaStore.EXTRA_MEDIA_TITLE));
        String artist = clean(intent.getStringExtra(MediaStore.EXTRA_MEDIA_ARTIST));
        if (!title.isEmpty()) query = (title + " " + artist).trim();
        else if (query.isEmpty()) query = artist;
        return Uri.parse(getString(R.string.launchUrl)).buildUpon()
                .appendQueryParameter("play", query)
                .build();
    }

    private static String clean(String s) {
        return s == null ? "" : s.trim();
    }
}
