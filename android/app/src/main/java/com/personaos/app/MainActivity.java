package com.personaos.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        /* Local plugins are not auto-discovered; they are registered here, before
           super.onCreate, so the bridge knows about them when it starts. */
        registerPlugin(HealthConnectPlugin.class);
        registerPlugin(SamsungHealthPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
