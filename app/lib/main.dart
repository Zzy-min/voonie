import 'package:flutter/material.dart';
import 'package:voonie_app/views/home_view.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const VoonieApp());
}

class VoonieApp extends StatelessWidget {
  const VoonieApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Voonie',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        primarySwatch: Colors.deepOrange,
        scaffoldBackgroundColor: const Color(0xFFFAF8F5),
      ),
      home: const HomeView(),
    );
  }
}
